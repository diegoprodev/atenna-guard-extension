"""
Tests for PDF parser V2 (native + Vision).
"""
import pytest
from dataclasses import fields
from document.parsers.pdf_parser_v2 import PdfParseResultV2, _format_table_as_text


def test_pdf_parse_result_v2_structure():
    """Test PdfParseResultV2 dataclass has required fields."""
    result = PdfParseResultV2(
        text="test", pages_parsed=1, total_pages=1,
        truncated=False, has_images=False, has_tables=False,
        extraction_method="test", error_code=None, error_message=None
    )

    # Verify all 9 fields exist
    field_names = {f.name for f in fields(PdfParseResultV2)}
    expected = {'text', 'pages_parsed', 'total_pages', 'truncated',
                'has_images', 'has_tables', 'extraction_method',
                'error_code', 'error_message'}
    assert field_names == expected


def test_format_table_as_text_simple():
    """Test table formatting."""
    table = [["Name", "Age"], ["Alice", "30"], ["Bob", "25"]]
    result = _format_table_as_text(table)

    assert "Name | Age" in result
    assert "Alice | 30" in result
    assert "Bob | 25" in result


def test_format_table_as_text_with_none():
    """Test table formatting with None cells."""
    table = [["A", None], [None, "2"]]
    result = _format_table_as_text(table)

    assert "A | " in result
    assert " | 2" in result


def test_pdf_parse_result_v2_is_frozen():
    """Test PdfParseResultV2 is immutable."""
    result = PdfParseResultV2(
        text="", pages_parsed=0, total_pages=0,
        truncated=False, has_images=False, has_tables=False,
        extraction_method="test", error_code=None, error_message=None
    )

    # Should not be able to modify
    with pytest.raises(AttributeError):
        result.text = "modified"
