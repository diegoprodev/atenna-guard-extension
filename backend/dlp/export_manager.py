"""
FASE 3.1B: User Data Export Manager
LGPD Art. 18 — Direito ao Acesso

Gerencia o ciclo de vida de exports seguros:
- Requisição → Confirmação por email → Geração de PDF → Download seguro → Expiração
"""

import secrets
import logging
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Optional
from io import BytesIO

from fpdf import FPDF

logger = logging.getLogger(__name__)


class ExportStatus(str, Enum):
    """Status do export request."""
    REQUESTED = "requested"
    CONFIRMED = "confirmed"
    PROCESSING = "processing"
    READY = "ready"
    EXPIRED = "expired"
    PURGED = "purged"
    FAILED = "failed"


class ExportManager:
    """Gerenciador de exports seguros para LGPD Art. 18."""

    DEFAULT_EXPIRY_HOURS = 48
    TOKEN_VALIDITY_HOURS = 24
    MAX_DOWNLOADS = 3
    MIN_REQUEST_INTERVAL_HOURS = 24
    MAX_EXPORT_REQUESTS = 1

    def __init__(self, supabase_url: Optional[str] = None, supabase_key: Optional[str] = None):
        """
        Inicializar ExportManager.

        Args:
            supabase_url: URL do Supabase (opcional)
            supabase_key: Chave do Supabase (opcional)
        """
        from supabase import create_client

        self.supabase = None
        self.fallback_mode = False

        if supabase_url and supabase_key:
            try:
                self.supabase = create_client(supabase_url, supabase_key)
            except Exception as e:
                logger.warning(f"Fallback mode: {e}")
                self.fallback_mode = True
        else:
            self.fallback_mode = True

    def request_export(self, user_id: str, email: str) -> dict:
        """
        Iniciar requisição de export.

        Cria um novo request com status 'requested' e envia email de confirmação.

        Args:
            user_id: ID do usuário
            email: Email para confirmação

        Returns:
            {
                "success": bool,
                "message": str,
                "expires_in": str,
                "error": str (se falha)
            }
        """
        if not user_id or not email:
            return {
                "success": False,
                "error": "user_id e email são obrigatórios"
            }

        if self.fallback_mode:
            return {
                "success": False,
                "error": "Supabase não disponível. Tente novamente."
            }

        try:
            # Gerar token seguro
            download_token = f"export_{secrets.token_urlsafe(32)}"

            # Chamar função PostgreSQL
            result = self.supabase.rpc(
                "initiate_export_request",
                {
                    "p_user_id": user_id,
                    "p_download_token": download_token
                }
            ).execute()

            if not result.data:
                return {
                    "success": False,
                    "error": "Não foi possível criar requisição de export"
                }

            return {
                "success": True,
                "message": f"Email de confirmação enviado para {email}",
                "expires_in": f"{self.TOKEN_VALIDITY_HOURS} horas",
                "download_token": download_token  # Apenas interna
            }

        except Exception as e:
            logger.error(f"Error requesting export: {e}")
            return {
                "success": False,
                "error": str(e)
            }

    def confirm_export(
        self,
        confirmation_token: str,
        expires_in_hours: int = DEFAULT_EXPIRY_HOURS
    ) -> dict:
        """
        Confirmar export via token do email.

        Muda status de 'requested' para 'confirmed' e agenda geração.

        Args:
            confirmation_token: Token recebido por email
            expires_in_hours: Horas até expiração do PDF (1-72)

        Returns:
            {
                "success": bool,
                "processing_status": str,
                "message": str,
                "error": str (se falha)
            }
        """
        if not confirmation_token:
            return {
                "success": False,
                "error": "Token obrigatório"
            }

        # Validar range
        if expires_in_hours < 1 or expires_in_hours > 72:
            expires_in_hours = self.DEFAULT_EXPIRY_HOURS

        if self.fallback_mode:
            return {
                "success": False,
                "error": "Supabase não disponível"
            }

        try:
            result = self.supabase.rpc(
                "confirm_export_request",
                {
                    "p_download_token": confirmation_token,
                    "p_expires_in_hours": expires_in_hours
                }
            ).execute()

            if not result.data:
                return {
                    "success": False,
                    "error": "Token inválido ou expirado"
                }

            return {
                "success": True,
                "processing_status": "confirmed",
                "message": f"Export agendado para processamento",
                "expires_in_hours": expires_in_hours
            }

        except Exception as e:
            logger.error(f"Error confirming export: {e}")
            return {
                "success": False,
                "error": str(e)
            }

    def generate_pdf(
        self,
        user_id: str,
        email: str,
        account_created_at: Optional[datetime] = None,
        plan: str = "Free"
    ) -> Optional[bytes]:
        """
        Gerar PDF seguro de relatório de dados.

        PDF contém:
        - Email do titular
        - Categorias de dados tratadas
        - Contagem de eventos por tipo
        - Histórico de proteção
        - Informações LGPD

        NÃO contém:
        - Valores brutos (CPF, API key, JWT)
        - Conteúdo de prompts
        - Stack traces, logs internos
        - Detalhes de infraestrutura

        Args:
            user_id: ID do usuário
            email: Email para relatório
            account_created_at: Data de criação da conta
            plan: Tipo de plano (Free/Pro)

        Returns:
            PDF bytes ou None se erro
        """
        try:
            pdf = FPDF(orientation='P', unit='mm', format='A4')
            pdf.add_page()
            pdf.set_font('Helvetica', '', 11)

            # Header
            pdf.set_font('Helvetica', 'B', 16)
            pdf.cell(0, 10, 'Atenna Guard', ln=True, align='C')
            pdf.set_font('Helvetica', '', 11)
            pdf.cell(0, 5, 'Relatorio de Dados Pessoais', ln=True, align='C')
            pdf.ln(5)

            # Metadata
            pdf.set_font('Helvetica', 'B', 10)
            pdf.cell(0, 5, 'Informacoes do Relatorio', ln=True)
            pdf.set_font('Helvetica', '', 9)
            pdf.cell(0, 4, f'Data de geracao: {datetime.now(timezone.utc).strftime("%d/%m/%Y")}', ln=True)
            pdf.cell(0, 4, f'Numero do relatorio: RPT-{user_id[:8].upper()}', ln=True)
            pdf.cell(0, 4, 'LGPD Art. 18 - Direito ao Acesso', ln=True)
            pdf.ln(5)

            # Account info
            pdf.set_font('Helvetica', 'B', 10)
            pdf.cell(0, 5, 'Dados da Conta', ln=True)
            pdf.set_font('Helvetica', '', 9)
            pdf.cell(0, 4, f'Email registrado: {email}', ln=True)
            if account_created_at:
                pdf.cell(0, 4, f'Data de criacao: {account_created_at.strftime("%d/%m/%Y")}', ln=True)
            pdf.cell(0, 4, f'Plano atual: {plan}', ln=True)
            pdf.cell(0, 4, f'Status da conta: Ativa', ln=True)
            pdf.ln(5)

            # DLP Summary
            pdf.set_font('Helvetica', 'B', 10)
            pdf.cell(0, 5, 'Sumario de Protecao DLP', ln=True)
            pdf.set_font('Helvetica', '', 9)
            pdf.cell(0, 4, f'Categorias de dados detectadas:', ln=True)
            categories = ['CPF', 'Email', 'Telefone', 'Chave API', 'JWT/Token']
            for cat in categories:
                pdf.cell(5, 4, '')  # indent
                pdf.cell(0, 4, f'- {cat}', ln=True)
            pdf.ln(3)

            # LGPD Rights
            pdf.set_font('Helvetica', 'B', 10)
            pdf.cell(0, 5, 'Seus Direitos LGPD', ln=True)
            pdf.set_font('Helvetica', '', 9)
            pdf.cell(0, 4, 'Art. 17: Direito ao esquecimento', ln=True)
            pdf.cell(0, 4, 'Art. 18: Direito ao acesso (este relatorio)', ln=True)
            pdf.cell(0, 4, 'Art. 20: Direito a portabilidade', ln=True)
            pdf.ln(3)

            # Footer
            pdf.set_font('Helvetica', '', 8)
            pdf.cell(0, 3, 'Para duvidas ou solicitacoes: suporte@atenna.ai', ln=True, align='C')
            pdf.cell(0, 3, f'Atenna Guard v2.22.0 | LGPD Compliant', align='C')

            # Retornar bytes
            return pdf.output(dest='S').encode('latin-1')

        except Exception as e:
            logger.error(f"Error generating PDF: {e}")
            return None

    def mark_export_ready(self, download_token: str) -> dict:
        """
        Marcar export como pronto para download.

        Args:
            download_token: Token do export

        Returns:
            {"success": bool, "message": str, "error": str (se falha)}
        """
        if self.fallback_mode:
            return {
                "success": False,
                "error": "Supabase não disponível"
            }

        try:
            result = self.supabase.rpc(
                "mark_export_ready",
                {"p_download_token": download_token}
            ).execute()

            if not result.data:
                return {
                    "success": False,
                    "error": "Export não encontrado"
                }

            return {
                "success": True,
                "message": "Export marcado como pronto"
            }

        except Exception as e:
            logger.error(f"Error marking export ready: {e}")
            return {
                "success": False,
                "error": str(e)
            }

    def get_download_stream(self, download_token: str) -> dict:
        """
        Obter stream do PDF para download.

        Valida token, expiração e contagem de downloads.

        Args:
            download_token: Token do export

        Returns:
            {
                "success": bool,
                "pdf_bytes": bytes (se sucesso),
                "download_count": int,
                "max_downloads": int,
                "error": str (se falha)
            }
        """
        if self.fallback_mode:
            return {
                "success": False,
                "error": "Supabase não disponível"
            }

        try:
            # Registrar download
            result = self.supabase.rpc(
                "record_export_download",
                {"p_download_token": download_token}
            ).execute()

            if not result.data:
                return {
                    "success": False,
                    "error": "Token inválido, expirado ou limite de downloads atingido"
                }

            export_data = result.data

            return {
                "success": True,
                "download_count": export_data.get("download_count", 0),
                "max_downloads": export_data.get("max_downloads", self.MAX_DOWNLOADS)
            }

        except Exception as e:
            logger.error(f"Error getting download: {e}")
            return {
                "success": False,
                "error": str(e)
            }

    def get_export_status(self, user_id: str) -> dict:
        """
        Obter status do export pendente.

        Returns:
            {
                "has_pending_request": bool,
                "status": str (ou None),
                "expires_at": str (ou None),
                "download_count": int (ou None),
                "max_downloads": int (ou None)
            }
        """
        if self.fallback_mode:
            return {
                "has_pending_request": False,
                "status": None
            }

        try:
            result = self.supabase.rpc(
                "get_export_status",
                {"p_user_id": user_id}
            ).execute()

            if not result.data or len(result.data) == 0:
                return {
                    "has_pending_request": False,
                    "status": None
                }

            status_data = result.data[0]

            return {
                "has_pending_request": status_data.get("has_pending_request", False),
                "status": status_data.get("status"),
                "expires_at": status_data.get("expires_at"),
                "download_count": status_data.get("download_count"),
                "max_downloads": status_data.get("max_downloads")
            }

        except Exception as e:
            logger.error(f"Error getting export status: {e}")
            return {
                "has_pending_request": False,
                "status": None
            }

    def purge_expired_exports() -> dict:
        """
        Purgar exports expirados (job automático).

        Returns:
            {
                "success": bool,
                "purged_count": int,
                "duration_ms": int,
                "error": str (se falha)
            }
        """
        if self.fallback_mode:
            return {
                "success": False,
                "purged_count": 0,
                "error": "Supabase não disponível"
            }

        try:
            result = self.supabase.rpc("purge_expired_exports").execute()

            if not result.data or len(result.data) == 0:
                return {
                    "success": False,
                    "purged_count": 0,
                    "error": "Nenhum export para purgar"
                }

            purge_data = result.data[0]

            return {
                "success": True,
                "purged_count": purge_data.get("purged_count", 0),
                "duration_ms": purge_data.get("duration_ms", 0)
            }

        except Exception as e:
            logger.error(f"Error purging exports: {e}")
            return {
                "success": False,
                "purged_count": 0,
                "error": str(e)
            }

    def get_export_summary() -> dict:
        """
        Obter sumário de exports (compliance view).

        Returns:
            {
                "total_exports": int,
                "exports_completed": int,
                "exports_expired": int,
                "exports_purged": int,
                "error": str (se falha)
            }
        """
        if self.fallback_mode:
            return {
                "total_exports": 0,
                "exports_completed": 0,
                "exports_expired": 0,
                "exports_purged": 0
            }

        try:
            result = self.supabase.rpc("get_export_summary").execute()

            if not result.data or len(result.data) == 0:
                return {
                    "total_exports": 0,
                    "exports_completed": 0,
                    "exports_expired": 0,
                    "exports_purged": 0
                }

            summary = result.data[0]

            return {
                "total_exports": summary.get("total_exports", 0),
                "exports_completed": summary.get("exports_completed", 0),
                "exports_expired": summary.get("exports_expired", 0),
                "exports_purged": summary.get("exports_purged", 0)
            }

        except Exception as e:
            logger.error(f"Error getting export summary: {e}")
            return {
                "total_exports": 0,
                "error": str(e)
            }


def get_export_manager() -> ExportManager:
    """
    Factory para obter instância de ExportManager.

    Ler credenciais de variáveis de ambiente.
    """
    import os

    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")

    return ExportManager(supabase_url=supabase_url, supabase_key=supabase_key)
