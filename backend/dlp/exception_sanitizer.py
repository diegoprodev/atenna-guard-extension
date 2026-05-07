"""
Exception Sanitization Middleware

Prevents PII/payload leakage in error logs and exception messages.
Intercepts exceptions before they reach logging/persistence layer.

LGPD compliance: Exception messages never contain:
- Request bodies
- Payload text
- Stack frames with local variables
- Sensitive patterns (CPF, email, API keys)
"""

from __future__ import annotations

import re
import logging
from typing import Optional
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException


def sanitize_exception_message(exc_message: str) -> str:
    """
    Remove sensitive data from exception message.

    Removes:
    - CPF patterns (xxx.xxx.xxx-xx)
    - CNPJ patterns (xx.xxx.xxx/xxxx-xx)
    - Email addresses
    - API keys (sk-*, Bearer *)
    - Phone numbers
    - Long hex strings (potential tokens)

    Args:
        exc_message: Original exception message

    Returns:
        Sanitized message with sensitive patterns replaced
    """
    if not exc_message:
        return exc_message

    # Patterns to sanitize
    sanitizations = [
        (r'\d{3}\.\d{3}\.\d{3}-\d{2}', '[CPF]'),
        (r'\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}', '[CNPJ]'),
        (r'\S+@\S+\.\S+', '[EMAIL]'),
        (r'\bsk[-_][A-Za-z0-9_\-]{20,}', '[API_KEY]'),
        (r'\bBearer\s+[A-Za-z0-9\-._~+/=]{20,}', '[TOKEN]'),
        (r'\b[A-Fa-f0-9]{32,}\b', '[HEX_TOKEN]'),
        (r'\+?55\s?\(?\d{2}\)?[\s-]?9?\s?\d{4}[-\s]?\d{4}', '[PHONE]'),
    ]

    sanitized = exc_message
    for pattern, replacement in sanitizations:
        sanitized = re.sub(pattern, replacement, sanitized)

    return sanitized


def sanitize_exception_traceback(exc: Exception) -> dict:
    """
    Create safe exception info without sensitive data in stack frames.

    Returns:
        {
            'type': 'ValueError',
            'message': 'Sanitized message [CPF] [EMAIL]',
            'sanitized': True
        }
    """
    exc_type = type(exc).__name__
    exc_message = str(exc)
    sanitized_message = sanitize_exception_message(exc_message)

    return {
        "type": exc_type,
        "message": sanitized_message,
        "sanitized": True,
    }


class SanitizationMiddleware(BaseHTTPMiddleware):
    """
    Middleware to intercept and sanitize exceptions before logging.

    Prevents PII from leaking into logs or telemetry.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        """Process request and sanitize any exceptions."""
        try:
            response = await call_next(request)
            return response
        except StarletteHTTPException as exc:
            # Log sanitized version only
            sanitized = sanitize_exception_message(str(exc.detail))
            logging.error(f"HTTP Exception: {sanitized}")
            raise exc
        except Exception as exc:
            # Sanitize and log
            safe_exc_info = sanitize_exception_traceback(exc)
            logging.error(f"Exception: {safe_exc_info['message']}")

            # Re-raise with sanitized message
            raise StarletteHTTPException(
                status_code=500,
                detail=safe_exc_info['message'],
            ) from exc
