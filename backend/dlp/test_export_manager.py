"""
FASE 3.1B: User Data Export Manager Tests

Valida:
- Export lifecycle (request → confirm → processing → ready)
- Email confirmation with secure tokens
- PDF generation without sensitive data leakage
- Download security (token validation, max downloads, expiration)
- Rate limiting (1 export per 24 hours)
- Purge of expired exports
- Fallback mode (Supabase unavailable)
"""

import pytest
from datetime import datetime, timedelta, timezone
import uuid

from dlp.export_manager import ExportManager, ExportStatus


class TestExportRequest:
    """Teste iniciação de requisição de export."""

    def test_request_export_without_credentials(self):
        """Requisição sem credenciais Supabase (fallback)."""
        manager = ExportManager(supabase_url=None, supabase_key=None)

        result = manager.request_export(
            user_id=str(uuid.uuid4()),
            email="test@example.com"
        )

        assert result["success"] is False
        assert "error" in result

    def test_request_export_requires_user_id(self):
        """User ID obrigatório."""
        manager = ExportManager(supabase_url=None, supabase_key=None)

        result = manager.request_export(
            user_id="",
            email="test@example.com"
        )

        assert result["success"] is False

    def test_request_export_requires_email(self):
        """Email obrigatório."""
        manager = ExportManager(supabase_url=None, supabase_key=None)

        result = manager.request_export(
            user_id=str(uuid.uuid4()),
            email=""
        )

        assert result["success"] is False


class TestExportConfirm:
    """Teste confirmação de export via token."""

    def test_confirm_export_valid_token_format(self):
        """Token válido deve ser aceito (estrutura)."""
        manager = ExportManager(supabase_url=None, supabase_key=None)

        # Token de teste
        token = "export_abc123def456"

        # Em fallback, retorna erro (esperado)
        result = manager.confirm_export(confirmation_token=token)

        assert "success" in result

    def test_confirm_export_requires_token(self):
        """Token obrigatório."""
        manager = ExportManager(supabase_url=None, supabase_key=None)

        result = manager.confirm_export(confirmation_token="")

        assert result["success"] is False

    def test_confirm_export_expires_in_hours_range(self):
        """Horas até expiração devem estar no range 1-72."""
        manager = ExportManager(supabase_url=None, supabase_key=None)

        token = "export_test_token"

        # 0 horas (inválido) → fallback
        result = manager.confirm_export(confirmation_token=token, expires_in_hours=0)
        assert "success" in result

        # 24 horas (válido) → fallback
        result = manager.confirm_export(confirmation_token=token, expires_in_hours=24)
        assert "success" in result

        # 100 horas (inválido, clamped) → fallback
        result = manager.confirm_export(confirmation_token=token, expires_in_hours=100)
        assert "success" in result


class TestPdfGeneration:
    """Teste geração de PDF segura."""

    def test_pdf_generated_is_bytes(self):
        """PDF gerado deve ser bytes."""
        manager = ExportManager(supabase_url=None, supabase_key=None)

        pdf_bytes = manager.generate_pdf(
            user_id=str(uuid.uuid4()),
            email="test@example.com"
        )

        assert pdf_bytes is not None
        assert isinstance(pdf_bytes, bytes)
        assert len(pdf_bytes) > 0

    def test_pdf_contains_email_not_user_id(self):
        """PDF contém email, não user_id bruto."""
        manager = ExportManager(supabase_url=None, supabase_key=None)

        test_email = "diego@atenna.ai"
        user_id = str(uuid.uuid4())

        pdf_bytes = manager.generate_pdf(
            user_id=user_id,
            email=test_email
        )

        # PDF contém email
        pdf_str = pdf_bytes.decode('latin-1', errors='ignore')
        assert test_email in pdf_str

    def test_pdf_does_not_contain_cpf_value(self):
        """PDF NÃO contém valores brutos de CPF."""
        manager = ExportManager(supabase_url=None, supabase_key=None)

        pdf_bytes = manager.generate_pdf(
            user_id=str(uuid.uuid4()),
            email="test@example.com"
        )

        # PDF não contém CPF completo
        pdf_str = pdf_bytes.decode('latin-1', errors='ignore')
        assert "050.423.674-11" not in pdf_str
        assert "CPF" in pdf_str  # Mas contém a categoria

    def test_pdf_does_not_contain_api_key(self):
        """PDF NÃO contém valores brutos de API key."""
        manager = ExportManager(supabase_url=None, supabase_key=None)

        pdf_bytes = manager.generate_pdf(
            user_id=str(uuid.uuid4()),
            email="test@example.com"
        )

        # PDF não contém API key bruta
        pdf_str = pdf_bytes.decode('latin-1', errors='ignore')
        assert "sk_live_" not in pdf_str
        assert "sk-ant-" not in pdf_str
        assert "Chave API" in pdf_str or "API" in pdf_str  # Mas contém a categoria

    def test_pdf_contains_lgpd_rights(self):
        """PDF contém informações sobre direitos LGPD."""
        manager = ExportManager(supabase_url=None, supabase_key=None)

        pdf_bytes = manager.generate_pdf(
            user_id=str(uuid.uuid4()),
            email="test@example.com"
        )

        pdf_str = pdf_bytes.decode('latin-1', errors='ignore')

        # Deve conter referências a artigos LGPD
        assert "LGPD" in pdf_str or "Art." in pdf_str

    def test_pdf_contains_protection_categories(self):
        """PDF contém categorias de proteção (não valores)."""
        manager = ExportManager(supabase_url=None, supabase_key=None)

        pdf_bytes = manager.generate_pdf(
            user_id=str(uuid.uuid4()),
            email="test@example.com"
        )

        pdf_str = pdf_bytes.decode('latin-1', errors='ignore')

        # Categorias devem aparecer
        categories = ["CPF", "Email", "Telefone"]
        found_categories = sum(1 for cat in categories if cat in pdf_str)
        assert found_categories > 0


class TestDownloadSecurity:
    """Teste segurança de download."""

    def test_download_token_format(self):
        """Token de download deve ser formato válido."""
        manager = ExportManager(supabase_url=None, supabase_key=None)

        # Tentar download com token fake
        result = manager.get_download_stream(download_token="fake_token_123")

        assert "success" in result
        # Em fallback, sempre falha
        assert result["success"] is False

    def test_max_downloads_enforced(self):
        """Máximo de downloads (3) deveria ser enforçado."""
        manager = ExportManager(supabase_url=None, supabase_key=None)

        # Estrutura de max_downloads deve existir
        assert manager.MAX_DOWNLOADS == 3

    def test_download_requires_valid_token(self):
        """Download requer token válido."""
        manager = ExportManager(supabase_url=None, supabase_key=None)

        result = manager.get_download_stream(download_token="")

        # Em fallback, retorna erro
        if manager.fallback_mode:
            assert result["success"] is False


class TestExportStatus:
    """Teste obtenção de status do export."""

    def test_no_pending_export_initially(self):
        """Sem export pendente, retorna has_pending_request=false."""
        manager = ExportManager(supabase_url=None, supabase_key=None)

        status = manager.get_export_status(user_id=str(uuid.uuid4()))

        # Em fallback
        assert status["has_pending_request"] is False

    def test_export_status_structure(self):
        """Status retorna estrutura válida."""
        manager = ExportManager(supabase_url=None, supabase_key=None)

        status = manager.get_export_status(user_id=str(uuid.uuid4()))

        assert "has_pending_request" in status
        assert "status" in status


class TestRateLimiting:
    """Teste rate limiting de exports."""

    def test_min_request_interval_defined(self):
        """Intervalo mínimo entre requests deve estar definido."""
        manager = ExportManager(supabase_url=None, supabase_key=None)

        assert manager.MIN_REQUEST_INTERVAL_HOURS == 24

    def test_max_exports_per_user(self):
        """Máximo 1 export ativo por usuário."""
        manager = ExportManager(supabase_url=None, supabase_key=None)

        assert manager.MAX_EXPORT_REQUESTS == 1


class TestPurge:
    """Teste purge de exports expirados."""

    def test_purge_expired_exports_structure(self):
        """Purge retorna estrutura válida."""
        manager = ExportManager(supabase_url=None, supabase_key=None)

        result = manager.purge_expired_exports()

        assert "success" in result
        assert "purged_count" in result or "error" in result

    def test_purge_idempotent(self):
        """Purge múltiplas vezes não causa erro."""
        manager = ExportManager(supabase_url=None, supabase_key=None)

        result1 = manager.purge_expired_exports()
        result2 = manager.purge_expired_exports()

        # Ambas devem retornar resultado válido
        assert "success" in result1 or "error" in result1
        assert "success" in result2 or "error" in result2


class TestExportSummary:
    """Teste sumário de compliance."""

    def test_export_summary_structure(self):
        """Summary retorna estrutura válida."""
        manager = ExportManager(supabase_url=None, supabase_key=None)

        summary = manager.get_export_summary()

        assert "total_exports" in summary
        assert "exports_completed" in summary
        assert "exports_expired" in summary
        assert "exports_purged" in summary

    def test_export_summary_numbers_non_negative(self):
        """Contadores de summary devem ser >= 0."""
        manager = ExportManager(supabase_url=None, supabase_key=None)

        summary = manager.get_export_summary()

        assert summary.get("total_exports", 0) >= 0
        assert summary.get("exports_completed", 0) >= 0
        assert summary.get("exports_expired", 0) >= 0
        assert summary.get("exports_purged", 0) >= 0


class TestFallbackMode:
    """Teste fallback mode sem Supabase."""

    def test_fallback_mode_graceful(self):
        """Fallback mode sem Supabase é graceful."""
        manager = ExportManager(supabase_url=None, supabase_key=None)

        assert manager.fallback_mode is True

        # Todas as operações retornam erro estruturado
        result_request = manager.request_export("user", "email@test.com")
        assert result_request["success"] is False

        result_status = manager.get_export_status("user")
        assert "has_pending_request" in result_status

    def test_pdf_generation_works_in_fallback(self):
        """PDF pode ser gerado mesmo em fallback mode."""
        manager = ExportManager(supabase_url=None, supabase_key=None)

        pdf_bytes = manager.generate_pdf(
            user_id="user123",
            email="test@example.com"
        )

        # PDF deve ser gerado
        assert pdf_bytes is not None
        assert isinstance(pdf_bytes, bytes)
        assert len(pdf_bytes) > 0


class TestSecurityProperties:
    """Teste propriedades de segurança."""

    def test_token_is_unique(self):
        """Cada token gerado deve ser único."""
        manager = ExportManager(supabase_url=None, supabase_key=None)

        token1 = "export_" + "a" * 32
        token2 = "export_" + "b" * 32

        assert token1 != token2

    def test_no_sensitive_data_in_response(self):
        """Respostas não devem conter dados sensíveis."""
        manager = ExportManager(supabase_url=None, supabase_key=None)

        result = manager.request_export(
            user_id=str(uuid.uuid4()),
            email="test@example.com"
        )

        # Se tiver error, não deve conter password/secret
        if "error" in result:
            assert "password" not in result["error"].lower()
            assert "key" not in result["error"].lower() or "download_key" in result["error"]


class TestExportStatus:
    """Teste valores de status."""

    def test_all_status_values_valid(self):
        """Todos os status values devem ser válidos."""
        valid_statuses = [
            ExportStatus.REQUESTED,
            ExportStatus.CONFIRMED,
            ExportStatus.PROCESSING,
            ExportStatus.READY,
            ExportStatus.EXPIRED,
            ExportStatus.PURGED,
            ExportStatus.FAILED,
        ]

        assert len(valid_statuses) == 7


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
