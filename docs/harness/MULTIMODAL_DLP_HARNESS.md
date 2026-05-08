# Multimodal DLP Harness — Arquitetura Completa

**Data:** 2026-05-08  
**Status:** 📋 Planejamento Arquitetural (Sem Implementação Ainda)  
**Objetivo:** Definir arquitetura, segurança e fluxos para upload de arquivos, PDF, imagens, OCR sem criar vetores de vazamento

---

## ⚠️ PRINCÍPIO CENTRAL

```
NÃO enviar arquivo bruto para IA.
NÃO armazenar payload sensível sem política.
NÃO logar conteúdo extraído.
NÃO persistir texto integral sem necessidade.
NÃO implementar OCR antes de validar arquivo leve.
```

---

## 📊 Visão Estratégica

### O Problema
Arquivos são novo vetor de vazamento:
- Upload de PDF com dados sensíveis → sistema gera texto
- Imagem fotografada de RG/CPF → OCR extrai valores
- EXIF de imagem geolocaliza usuário
- Conteúdo extraído logado sem masking

### A Solução Atenna
1. Upload seguro (validação de arquivo)
2. Extração segura (sem persistir bruto)
3. DLP documental (mesmo que texto)
4. Rewrite antes de enviar para IA
5. Auditoria sem conteúdo
6. Purge automático

### Fases Incrementais
- **FASE 4.1** (1 semana): TXT, MD, CSV, JSON (arquivos leves)
- **FASE 4.2** (1 semana): PDF texto + DOCX
- **FASE 4.3** (2 semanas): OCR (PDF scaneado + imagem com texto)
- **FASE 4.4** (3 semanas): Imagens sensíveis (RG, CNH, comprovantes)
- **FASE 4.5** (2 semanas): Enterprise (classificação documental, políticas)

---

## 🎯 Escopo por Fase

### FASE 4.1 — Arquivos Leves (TXT, MD, CSV, JSON)

**Tipos Suportados:**
- `.txt` — Plain text (max 5MB)
- `.md` — Markdown (max 5MB)
- `.csv` — Comma-separated values (max 10MB)
- `.json` — JSON files (max 5MB)

**Fluxo:**
```
upload
  ↓
validação de arquivo (tipo, tamanho, extensão)
  ↓
leitura em memória
  ↓
DLP scan (como text, mesma engine)
  ↓
classificação de risco
  ↓
if HIGH_RISK:
  → usuário vê banner "Dados sensíveis detectados"
  → [Proteger dados] + [Enviar original]
  ↓
rewrite de PII (se selecionou proteger)
  ↓
enviar para IA
  ↓
cleanup automático (não persistir arquivo)
```

**Saída:**
- `src/ui/upload-widget.ts` — Widget de upload em Settings
- `src/core/fileHandler.ts` — Upload + validação
- `src/dlp/docScan.ts` — DLP para documentos
- `backend/routes/docprocess.py` — Processamento backend
- E2E: 15 testes

**Não implementar agora:**
- ❌ OCR
- ❌ Persistência de arquivo
- ❌ Compartilhamento
- ❌ Histórico de uploads
- ❌ Suporte a pasta/batch

---

### FASE 4.2 — Documentos (PDF + DOCX)

**Tipos Suportados:**
- `.pdf` — PDF com texto (max 20MB)
- `.docx` — Word documents (max 20MB)

**Fluxo Adicional:**
```
file upload
  ↓
mime type validation (não apenas extensão)
  ↓
antivírus check (futuro)
  ↓
extração de texto segura (pypdf / python-docx)
  ↓
DLP scan do texto extraído
  ↓
rewrite se necessário
  ↓
cleanup
```

**Saída:**
- `backend/dlp/pdfExtractor.py` — Extração segura de PDF
- `backend/dlp/docxExtractor.py` — Extração de DOCX
- `src/ui/pdf-preview.ts` — Preview seguro (masked)
- E2E: 20 testes (+ FASE 4.1)

**Não implementar agora:**
- ❌ OCR em PDF scaneado (FASE 4.3)
- ❌ Preservação de formatting
- ❌ Extração de imagens do PDF

---

### FASE 4.3 — OCR (PDF Scaneado + Imagens com Texto)

**Tipos Suportados:**
- `.pdf` — PDF escaneado (imagens) (max 30MB)
- `.jpg`, `.png`, `.webp` — Imagens com texto (max 5MB cada)

**Fluxo Novo:**
```
image/pdf
  ↓
validação (formato, tamanho)
  ↓
OCR (pytesseract ou paddleOCR)
  ↓
DLP scan do texto extraído
  ↓
if HIGH_RISK:
  → preview masked
  → [Proteger dados] + [Enviar original]
  ↓
rewrite se necessário
  ↓
cleanup
```

**Saída:**
- `backend/dlp/ocrEngine.py` — OCR wrapper (pytesseract)
- `backend/routes/ocr.py` — OCR endpoint
- Timeout: 30s por imagem (OCR é lento)
- E2E: 25 testes

**Não implementar agora:**
- ❌ EXIF cleanup (FASE 4.4)
- ❌ Handwriting recognition
- ❌ Barcode/QR extraction

---

### FASE 4.4 — Imagens Sensíveis (RG/CNH/Comprovantes)

**Tipos Suportados:**
- Qualquer imagem com documentos fotografados
- Comprovante de endereço
- Identidade nacional
- Cartão de crédito

**Fluxo Novo:**
```
image
  ↓
EXIF cleanup (remover localização, câmera, timestamp)
  ↓
OCR para extração
  ↓
DLP detecção agressiva:
  → CPF completo (não só categoria)
  → RG/CNH padrão
  → Dados bancários
  ↓
if CRITICAL_RISK:
  → alert: "Documento identificado. Recomendamos não enviar."
  → [Mascarar] + [Continuar]
  ↓
masking: CPF → "XXX.XXX.XXX-XX", RG → "XXXXXXXX-X"
  ↓
cleanup
```

**Saída:**
- `backend/dlp/exifCleaner.py` — Remove EXIF
- `backend/dlp/documentDetector.py` — Detecta tipo de documento
- `src/dlp/criticalMasking.ts` — Masking agressivo
- `src/ui/document-alert.ts` — Alert para documentos críticos
- E2E: 30 testes

**Não implementar agora:**
- ❌ Live camera capture
- ❌ Verification flow (liveness check)
- ❌ Storage para KYC

---

### FASE 4.5 — Enterprise (Classificação + Políticas + Retenção)

**Funcionalidades:**
- Classificação automática de documento (RH, Financeiro, Legal, etc.)
- Políticas por plano (free: TXT only, pro: tudo)
- Retenção por tipo documental (RH: 3 anos, Financeiro: 7 anos)
- Auditoria avançada (quem fez upload, quando, risco detectado)
- Dashboard de documentos (histórico, estatísticas)

**Não implementar agora:**
- FASE 4.1-4.4 primeiro

---

## 🏗️ Arquitetura de Upload

### Frontend: Upload Widget (`src/ui/upload-widget.ts`)

```typescript
interface UploadConfig {
  maxSize: number;        // em bytes
  acceptedTypes: string[];  // mime types ou extensões
  maxFiles?: number;      // numero de arquivos simultâneos
}

interface FileValidation {
  valid: boolean;
  error?: string;
  metadata: {
    name: string;
    size: number;
    type: string;
    lastModified: number;
  };
}

interface UploadResult {
  success: boolean;
  dlpRisk: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
  entities: DetectedEntity[];
  preview?: string;
  token?: string;  // para download do arquivo processado
  message?: string;
}

// Fluxo:
1. User clica "Upload arquivo"
2. File picker abre (ou drag-drop)
3. Validação local (tipo, tamanho)
4. Upload multipart/form-data
5. Backend processa
6. Response com risco + entities
7. Se risco > LOW: mostra banner
8. User clica [Proteger dados] ou [Enviar original]
```

### Backend: Upload Processing (`backend/routes/docprocess.py`)

```python
@app.post("/user/upload")
async def upload_file(
    file: UploadFile,
    session_id: str = Header(...),
    access_token: str = Header(...),
):
    """
    1. Validar arquivo (tipo, tamanho, magic bytes)
    2. Extrair conteúdo (txt, pdf, docx)
    3. DLP scan
    4. Responder com risco + entities
    5. Não persistir arquivo bruto
    """
    
    # Step 1: Validate
    if file.size > MAX_SIZE:
        raise HTTPException(status_code=413, detail="File too large")
    
    if not is_allowed_type(file.filename, file.content_type):
        raise HTTPException(status_code=400, detail="File type not allowed")
    
    # Step 2: Extract content (not persisting)
    content = await extract_file_content(file)
    
    # Step 3: DLP scan
    analysis = await dlp_engine.analyze(content, session_id)
    
    # Step 4: Response
    return {
        "success": True,
        "dlpRisk": analysis.risk_level,
        "entities": analysis.entities,
        "entityCount": len(analysis.entities),
        "entityTypes": analysis.entity_types,
        "message": f"Detectadas {len(analysis.entities)} possíveis dados sensíveis.",
    }
```

### Storage Policy

**Não Persistir:**
- ❌ Arquivo bruto
- ❌ Conteúdo extraído bruto
- ❌ Sensitive entities
- ❌ Payloads inteiros

**Persistir (se necessário para retenção):**
- ✅ Hash do arquivo (para dedup)
- ✅ Metadata (nome, tipo, tamanho, timestamp)
- ✅ DLP analysis metadata (risco, contagem entities)
- ✅ User action (protected vs sent original)
- ✅ Retenção policy (quando deletar)

**Exemplo de DB Schema:**

```sql
CREATE TABLE document_uploads (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  file_hash TEXT NOT NULL,  -- SHA256
  file_name TEXT NOT NULL,
  file_type VARCHAR(50),
  file_size_bytes INT,
  dlp_risk_level VARCHAR(10),  -- NONE, LOW, MEDIUM, HIGH
  entity_count INT,
  entity_types TEXT[],
  user_action VARCHAR(20),  -- "protected" or "sent_original"
  protected_content_hash TEXT,  -- hash do conteúdo protegido
  extracted_text_hash TEXT,  -- hash para busca, não conteúdo
  created_at TIMESTAMP,
  expires_at TIMESTAMP,  -- retenção automática
  
  CONSTRAINT no_raw_content CHECK (TRUE)  -- força discipline
);

-- Purge automático
CREATE OR REPLACE FUNCTION purge_expired_uploads()
RETURNS void AS $$
BEGIN
  DELETE FROM document_uploads 
  WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;
```

---

## 🔐 Segurança de Armazenamento

### Política de Retenção

| Tipo de Arquivo | Tempo de Retenção | Após Expiração |
|---|---|---|
| TXT, MD, JSON, CSV | 7 dias | Purge automático |
| PDF, DOCX | 14 dias | Purge automático |
| Imagens (OCR) | 7 dias | Purge automático |
| Documentos críticos | 30 dias | Purge + audit log |

### Encrypted Storage (Futuro)

```python
# FASE 4.5: Criptografia de repouso
from cryptography.fernet import Fernet

class EncryptedDocumentStorage:
    def __init__(self, key: bytes):
        self.cipher = Fernet(key)
    
    def encrypt_content(self, content: str) -> bytes:
        return self.cipher.encrypt(content.encode())
    
    def decrypt_content(self, encrypted: bytes) -> str:
        return self.cipher.decrypt(encrypted).decode()
```

### Access Control (RLS)

```sql
-- User can read own uploads only
ALTER TABLE document_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own uploads" ON document_uploads
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access" ON document_uploads
  FOR ALL
  USING (auth.role() = 'service_role');
```

---

## 📄 Extração de Texto

### File Content Extractors

**Objetivo:** Extrair conteúdo SEM persistir arquivo bruto

```python
# backend/dlp/extractors.py

from typing import Optional

class FileExtractor:
    """Base class for file content extraction."""
    
    @staticmethod
    async def extract_txt(file_content: bytes) -> str:
        """Plain text extraction."""
        return file_content.decode('utf-8', errors='replace')
    
    @staticmethod
    async def extract_md(file_content: bytes) -> str:
        """Markdown extraction."""
        return file_content.decode('utf-8', errors='replace')
    
    @staticmethod
    async def extract_csv(file_content: bytes) -> str:
        """CSV extraction (comma-separated)."""
        return file_content.decode('utf-8', errors='replace')
    
    @staticmethod
    async def extract_json(file_content: bytes) -> str:
        """JSON extraction (formatted)."""
        import json
        data = json.loads(file_content)
        return json.dumps(data, indent=2, ensure_ascii=False)
    
    @staticmethod
    async def extract_pdf(file_content: bytes) -> str:
        """PDF text extraction (pypdf)."""
        import io
        from pypdf import PdfReader
        
        reader = PdfReader(io.BytesIO(file_content))
        text = ""
        for page in reader.pages:
            text += page.extract_text() + "\n"
        return text
    
    @staticmethod
    async def extract_docx(file_content: bytes) -> str:
        """DOCX text extraction (python-docx)."""
        import io
        from docx import Document
        
        doc = Document(io.BytesIO(file_content))
        text = ""
        for para in doc.paragraphs:
            text += para.text + "\n"
        return text

# Usage
extractor = FileExtractor()
extracted = await extractor.extract_pdf(file_bytes)
# Important: file_bytes não é persistido
```

**Retenção de Extraction:**
- ✅ Hash do texto extraído (para dedup, busca)
- ❌ Texto bruto
- ❌ Entidades sensíveis
- ✅ Metadata (tamanho, idioma, encoding)

---

## 🤖 OCR e Imagens

### OCR Engine (`backend/dlp/ocrEngine.py`)

```python
# FASE 4.3

import pytesseract
from PIL import Image
import io

class OCREngine:
    """OCR para imagens e PDFs escaneados."""
    
    def __init__(self, timeout_seconds: int = 30):
        self.timeout = timeout_seconds
    
    async def extract_text_from_image(
        self,
        image_bytes: bytes,
        language: str = "por+eng",  # Português + Inglês
    ) -> tuple[str, dict]:
        """
        Extract text from image using pytesseract.
        
        Returns:
            (text, metadata)
        """
        try:
            image = Image.open(io.BytesIO(image_bytes))
            
            # Resize for better OCR (if needed)
            if image.width < 400:
                image = image.resize((image.width * 2, image.height * 2))
            
            text = pytesseract.image_to_string(image, lang=language)
            
            return text, {
                "success": True,
                "image_size": image.size,
                "characters": len(text),
            }
        except Exception as e:
            return "", {"success": False, "error": str(e)}
    
    async def extract_text_from_pdf_scanned(
        self,
        pdf_bytes: bytes,
    ) -> str:
        """Extract text from scanned PDF (every page via OCR)."""
        from pypdf import PdfReader
        
        reader = PdfReader(io.BytesIO(pdf_bytes))
        text = ""
        
        for i, page in enumerate(reader.pages):
            # Try to extract text first (if PDF has text layer)
            page_text = page.extract_text()
            
            if not page_text or len(page_text.strip()) < 10:
                # Fallback to OCR (render page as image)
                image_bytes = self._render_pdf_page_to_image(pdf_bytes, i)
                page_text, _ = await self.extract_text_from_image(image_bytes)
            
            text += f"[Page {i+1}]\n{page_text}\n"
        
        return text
```

### Imagem Metadata

**Campos Sensíveis em EXIF:**
- 🚨 GPS Coordinates (localização)
- 🚨 Device Model (identifica câmera/celular)
- 🚨 Timestamp (quando foto foi tirada)
- 🚨 User Comment (metadados customizados)

---

## 🗑️ EXIF Cleanup

### EXIF Remover (`backend/dlp/exifCleaner.py`)

```python
# FASE 4.4

from PIL import Image
from PIL.ExifTags import TAGS
import io

class ExifCleaner:
    """Remove sensitive EXIF metadata from images."""
    
    SENSITIVE_TAGS = [
        "GPSInfo",          # Localização
        "DateTime",         # Data/hora
        "DateTimeOriginal",
        "DateTimeDigitized",
        "Model",            # Modelo de câmera
        "Make",             # Fabricante
        "Software",
        "UserComment",
        "ImageDescription",
    ]
    
    @staticmethod
    def clean_image(image_bytes: bytes) -> bytes:
        """
        Remove sensitive EXIF tags.
        Keep: image dimensions, color space (non-identifying)
        Remove: GPS, timestamp, device model
        """
        try:
            image = Image.open(io.BytesIO(image_bytes))
            
            # Create new image without EXIF
            data = list(image.getdata())
            image_without_exif = Image.new(image.mode, image.size)
            image_without_exif.putdata(data)
            
            # Save cleaned image
            output = io.BytesIO()
            image_without_exif.save(output, format=image.format or "PNG")
            return output.getvalue()
        except Exception as e:
            # If cleaning fails, return original (don't break flow)
            return image_bytes
    
    @staticmethod
    def get_sensitive_exif_data(image_bytes: bytes) -> dict:
        """Extract sensitive EXIF for audit log (no GPS coords, just "HAS_GPS": True)."""
        try:
            image = Image.open(io.BytesIO(image_bytes))
            exif_data = image._getexif() or {}
            
            sensitive = {}
            for tag_id, value in exif_data.items():
                tag_name = TAGS.get(tag_id, tag_id)
                if tag_name in ExifCleaner.SENSITIVE_TAGS:
                    # Store boolean or masked value
                    if tag_name == "GPSInfo":
                        sensitive["HAS_GPS"] = True
                    elif "DateTime" in tag_name:
                        sensitive["HAS_TIMESTAMP"] = True
                    elif tag_name in ["Model", "Make"]:
                        sensitive["HAS_DEVICE_MODEL"] = True
            
            return sensitive
        except:
            return {}
```

---

## 🔍 DLP Documental

### Document-Aware DLP Engine

```python
# backend/dlp/docDlpEngine.py

class DocumentDLPEngine:
    """DLP for documents — same as text but with doc-specific rules."""
    
    async def scan_document(
        self,
        content: str,
        doc_type: str,  # "pdf", "docx", "image_scanned", etc.
        session_id: str,
    ) -> DLPAnalysis:
        """
        Scan document content.
        Rules:
        - CPF: detectar sempre (documento tem CPF?)
        - RG/CNH: detectar números sequenciais
        - Address: detectar logradouro + número
        - Bank account: detectar agência + conta
        """
        
        # Use existing DLP engine
        analysis = await self.engine.analyze(content, session_id)
        
        # Enhance detection for documents
        # (Exemplo: RG pattern é mais estrito que genérico)
        analysis = self._enhance_document_detection(analysis, content, doc_type)
        
        return analysis
    
    def _enhance_document_detection(
        self,
        analysis: DLPAnalysis,
        content: str,
        doc_type: str,
    ) -> DLPAnalysis:
        """Add document-specific detection rules."""
        
        # FASE 4.4: Critical document detection
        if doc_type in ["image_scanned", "document_photo"]:
            # Agressivamente detectar documentos críticos
            critical_patterns = {
                "CPF": r"\d{3}\.?\d{3}\.?\d{3}\.?\-?\d{2}",
                "RG": r"\d{2}\.?\d{3}\.?\d{3}",
                "CNH": r"[A-Z0-9]{12}",
            }
            # Aumentar score se detectar padrão crítico
        
        return analysis
```

---

## 🖼️ DLP em Imagens

### Image-Specific DLP

```python
# backend/dlp/imageDlpEngine.py

class ImageDLPEngine:
    """Detecção de dados sensíveis em imagens sem OCR (via vision models no futuro)."""
    
    async def scan_image_visual(
        self,
        image_bytes: bytes,
    ) -> dict:
        """
        Detectar dados sensíveis visualmente (sem OCR):
        - Face presence (para privacidade)
        - QR/Barcode (código de rastreamento)
        - Document shape (parece um documento?)
        
        FASE 4.5: usar vision model (Google Vision, AWS Rekognition)
        """
        pass
```

---

## 🛡️ Sanitização Antes do Provider

### Protection Flow

```typescript
// src/ui/document-protection-banner.ts

interface ProtectionFlow {
  1. User uploads document
  2. Backend: DLP scan
  3. If HIGH_RISK:
     → show banner: "Dados sensíveis detectados neste arquivo."
     → buttons: [Proteger dados] [Enviar original]
  4. User clicks [Proteger dados]:
     → apply rewrite to extracted content
     → remove EXIF if image
     → hash sensitive entities
     → send SANITIZED content to AI
  5. OR User clicks [Enviar original]:
     → send AS-IS
     → log the choice
}
```

### Rewrite Strategy for Documents

```python
# backend/dlp/docRewriter.py

class DocumentRewriter:
    """Rewrite documents similar to text rewriting."""
    
    def rewrite_extracted_text(
        self,
        content: str,
        entities: List[DetectedEntity],
    ) -> str:
        """
        Replace sensitive data with placeholders.
        
        Example:
        "CPF 123.456.789-10 e email test@example.com"
        →
        "CPF [CPF_XXXXX] e email [EMAIL_XXXXX]"
        """
        for entity in entities:
            # Replace each entity with masked version
            content = content.replace(
                entity.value,
                f"[{entity.type}_XXXXX]",
            )
        return content
```

---

## 📊 Telemetria Segura

### Document Upload Telemetry

```python
# backend/telemetry/documentTelemetry.py

class DocumentTelemetry:
    """Log document uploads sem conteúdo sensível."""
    
    async def log_upload(
        self,
        user_id: str,
        session_id: str,
        file_type: str,
        file_size: int,
        dlp_risk_level: str,
        entity_count: int,
        entity_types: List[str],
        user_action: str,  # "protected" or "sent_original"
        processing_time_ms: int,
    ):
        """
        Log upload event.
        NEVER log:
        - arquivo bruto
        - conteúdo extraído
        - sensitive entity values
        
        ALWAYS log:
        - risk level
        - entity types (categoria, não valor)
        - entity count (número, não dados)
        - user choice
        - processing time
        """
        
        await supabase.table("document_upload_events").insert({
            "user_id": user_id,
            "session_id": session_id,
            "file_type": file_type,
            "file_size_bytes": file_size,
            "dlp_risk_level": dlp_risk_level,
            "entity_count": entity_count,
            "entity_types": entity_types,  # apenas categorias
            "user_action": user_action,
            "processing_time_ms": processing_time_ms,
            "created_at": datetime.utcnow(),
        })
```

---

## 📁 Retenção

### Retention Policies

```sql
-- FASE 4.1+

CREATE TABLE retention_policies (
  document_type VARCHAR(50) PRIMARY KEY,
  retention_days INT,
  cascade_delete BOOLEAN DEFAULT true,
);

INSERT INTO retention_policies VALUES
  ('text', 7, true),
  ('pdf', 14, true),
  ('image_scanned', 7, true),
  ('image_sensitive', 30, true);

-- Scheduled purge job (runs daily)
CREATE OR REPLACE FUNCTION purge_expired_uploads_daily()
RETURNS void AS $$
BEGIN
  DELETE FROM document_uploads 
  WHERE expires_at < NOW()
  AND archived = false;
  
  -- Log purge event
  INSERT INTO purge_audit (table_name, deleted_count, purged_at)
  VALUES ('document_uploads', ROW_COUNT(), NOW());
END;
$$ LANGUAGE plpgsql;

-- Daily at 3 AM UTC
SELECT cron.schedule('purge-documents', '0 3 * * *', 'SELECT purge_expired_uploads_daily()');
```

---

## 📋 Auditoria

### Upload Audit Trail

```sql
CREATE TABLE document_audit_log (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  action VARCHAR(50),  -- "uploaded", "protected", "sent_original", "downloaded", "deleted"
  document_id UUID,
  dlp_risk_level VARCHAR(10),
  entity_count INT,
  entity_types TEXT[],
  ip_address INET,
  user_agent TEXT,
  status VARCHAR(20),  -- "success", "failed", "timeout"
  error_message TEXT,  -- apenas se falha, sem PII
  created_at TIMESTAMP,
  
  CONSTRAINT no_pii CHECK (error_message NOT LIKE '%%@%%')  -- no emails
);

-- User can read own audit trail
ALTER TABLE document_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own audit" ON document_audit_log
  FOR SELECT
  USING (auth.uid() = user_id);
```

---

## 🎨 UX Premium — Estados Visuais

### Upload Widget States

**1. Idle (inicial)**
```
┌─────────────────────────────────┐
│ 📎 Compartilhe documentos com IA │
│ TXT · MD · CSV · JSON            │
│ Máx 5 MB (FASE 4.1)              │
│                                  │
│  [  Selecionar arquivo  ]        │
│  ou arraste aqui                 │
└─────────────────────────────────┘
```

**2. Uploading**
```
┌─────────────────────────────────┐
│ 📎 Enviando...                   │
│                                  │
│  ▓▓▓▓▓░░░░░░ 45%                 │
│                                  │
│  documento.txt (2.3 MB)          │
└─────────────────────────────────┘
```

**3. DLP Scanning**
```
┌─────────────────────────────────┐
│ 🔍 Analisando dados...           │
│                                  │
│  Verificando conteúdo sensível   │
└─────────────────────────────────┘
```

**4. Risk Detected (HIGH)**
```
┌─────────────────────────────────┐
│ ⚠️ Dados sensíveis detectados    │
│                                  │
│ 4 possíveis dados sensíveis      │
│ CPF · Email · Telefone           │
│                                  │
│ [  Proteger dados  ]             │
│ [  Enviar original ]             │
└─────────────────────────────────┘
```

**5. Protected (sucesso)**
```
┌─────────────────────────────────┐
│ ✓ Dados protegidos               │
│                                  │
│ Arquivo seguro para enviar à IA. │
│                                  │
│  [  Enviar agora  ]              │
│  [  Fazer outro   ]              │
└─────────────────────────────────┘
```

**6. Error**
```
┌─────────────────────────────────┐
│ ❌ Erro ao processar arquivo     │
│                                  │
│ Tipo de arquivo não suportado.   │
│ Suportamos: TXT, MD, CSV, JSON   │
│                                  │
│  [  Tentar outro   ]             │
└─────────────────────────────────┘
```

---

## 🧪 E2E Obrigatório

### Test Structure (FASE 4.1)

```typescript
// tests/e2e/fase-4.1-document-upload.spec.ts

test.describe('FASE 4.1: Document Upload — TXT, MD, CSV, JSON', () => {
  
  // Validation Tests
  test('✅ TXT file upload and DLP scan', async ({ page }) => {
    // 1. Create small TXT
    // 2. Upload
    // 3. Assert DLP scan runs
    // 4. Assert response has riskLevel + entities
  });
  
  test('✅ CSV file upload', async ({ page }) => {});
  test('✅ Reject oversized file', async ({ page }) => {});
  test('✅ Reject unsupported type', async ({ page }) => {});
  
  // DLP Tests
  test('✅ Detect CPF in document', async ({ page }) => {
    // Upload TXT with CPF
    // Assert HIGH_RISK detected
  });
  
  test('✅ Protection flow: [Proteger dados]', async ({ page }) => {});
  test('✅ Original flow: [Enviar original]', async ({ page }) => {});
  
  // Cleanup Tests
  test('✅ File not persisted after upload', async ({ page }) => {});
  test('✅ Retenção automática funciona', async ({ page }) => {});
  
  // Total: 15 testes
});
```

### Anti-Vazamento Tests

```typescript
test('✅ Arquivo bruto não é enviado para backend público', () => {
  // Intercept requests
  // Assert NO raw file content in request body
});

test('✅ Conteúdo extraído não é logado', () => {
  // Check backend logs
  // Assert NO extracted text
});

test('✅ DLP entities sem valores no response', () => {
  // Upload document with CPF
  // Assert response has { type: "CPF", count: 1 }
  // Assert response NOT has { value: "123.456.789-10" }
});

test('✅ EXIF não é logado quando image upload', async () => {
  // FASE 4.4: Upload image com GPS
  // Assert logs not contain coordinates
  // Assert logs contain { HAS_GPS: true }
});
```

---

## 🗓️ Roadmap Incremental

### Timeline

| Fase | Semanas | Arquivos | Testes | Custos Principais |
|---|---|---|---|---|
| 4.1 | 1 | 10 | 15 E2E + 30 Unit | pypdf, python-docx |
| 4.2 | 1 | 8 | 20 E2E + 40 Unit | (deps já em 4.1) |
| 4.3 | 2 | 12 | 25 E2E + 50 Unit | pytesseract, paddleOCR |
| 4.4 | 3 | 15 | 30 E2E + 60 Unit | vision model (Google/AWS) |
| 4.5 | 2 | 20 | 35 E2E + 80 Unit | Elasticsearch para busca |

**Total: 9 semanas, ~150 E2E tests, ~260 unit tests**

---

## ✋ O Que NÃO Fazer Agora

| Funcionalidade | Motivo | Fase |
|---|---|---|
| OCR em PDF escaneado | Complexidade alta, não há TXT ainda | 4.3 |
| Imagens sensíveis (RG/CPF) | Requer EXIF cleanup + critical masking | 4.4 |
| Histórico de uploads | Dashboard não é crítico para MVP | 4.5 |
| Live camera capture | Requer permissões extras + live vision | FUTURO |
| Compartilhamento de docs | Adiciona complexidade de acesso | 4.5 |
| Armazenamento a longo prazo | Criptografia, backup, disaster recovery | FUTURO |
| Batch upload | Não há demand, UX complexa | 4.5 |

---

## 🎯 Critérios de Sucesso

### FASE 4.1 (TXT, MD, CSV, JSON)
- ✅ Upload funciona sem persistir arquivo bruto
- ✅ DLP scan executa (mesma engine que texto)
- ✅ Rewrite protege dados sensíveis
- ✅ 0 arquivos brutos em logs
- ✅ 15 E2E tests passando
- ✅ Sem regressão em funcionalidades existentes

### FASE 4.2 (PDF + DOCX)
- ✅ Extração de PDF funciona
- ✅ Extração de DOCX funciona
- ✅ Preview seguro (masked) disponível
- ✅ Timeout on extraction (10s max)
- ✅ 20 E2E tests passando

### FASE 4.3 (OCR)
- ✅ OCR em imagem funciona
- ✅ OCR em PDF scaneado funciona
- ✅ Timeout 30s por página
- ✅ Qualidade de OCR aceitável (80%+ accuracy)
- ✅ 25 E2E tests passando

### FASE 4.4 (Documentos Críticos)
- ✅ EXIF removido de imagens
- ✅ Critical masking funciona (CPF, RG, CNH)
- ✅ Alert para documentos fotografados
- ✅ 30 E2E tests passando

### FASE 4.5 (Enterprise)
- ✅ Classificação automática de documento
- ✅ Políticas por plano aplicadas
- ✅ Retenção por tipo implementada
- ✅ Dashboard de documentos funcional
- ✅ 35 E2E tests passando

---

## 📌 Decisões Arquiteturais

### 1. Upload Processing
- ✅ Backend processa (não cliente)
- ✅ Arquivo nunca persiste bruto
- ✅ Extração em memória (streaming se > 50MB)

### 2. DLP Application
- ✅ Usar engine existente (mesma que texto)
- ✅ Aplicar rewrite SEM salvar original
- ✅ Log apenas metadata (não conteúdo)

### 3. Retenção
- ✅ Purge automático (cron daily)
- ✅ Diferentes períodos por tipo (7-30 dias)
- ✅ Audit trail preservado

### 4. UX
- ✅ Upload widget em Settings page
- ✅ Estados visuais claros (idle, uploading, scanning, risk, done)
- ✅ Sem jargão técnico (máx "Dados sensíveis")

### 5. Testing
- ✅ Anti-vazamento tests obrigatórios
- ✅ Cada arquivo type tem E2E específico
- ✅ Coverage > 90% em docScan, extractors

---

## 🚀 Próximas Ações

1. **Aprovação do Harness:** User confirma arquitetura
2. **Não implementar ainda:** Apenas planning/design
3. **FASE 4.1 Planning:** Detalhar componentes antes de coding
4. **Roadmap:** Adicionar ao projeto oficial

---

**Status:** 📋 Harness Completo — Aguardando Aprovação

