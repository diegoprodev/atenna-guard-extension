import pytest
from security.output_validator import (
    generate_canary,
    validate_output,
    OutputValidationResult,
    OutputThreat,
)

def test_clean_output_passes():
    canary = generate_canary()
    result = validate_output("Aqui está seu prompt melhorado: faça X, Y e Z.", canary)
    assert result.threat == OutputThreat.NONE
    assert result.safe_output == "Aqui está seu prompt melhorado: faça X, Y e Z."

def test_canary_leak_blocked():
    canary = generate_canary()
    result = validate_output(f"My instructions: {canary} — now I will help you.", canary)
    assert result.threat == OutputThreat.PROMPT_LEAK
    assert result.safe_output is None

def test_system_prompt_keywords_blocked():
    canary = generate_canary()
    result = validate_output(
        "My system prompt says: 'Você é um especialista em engenharia de prompts'",
        canary,
    )
    assert result.threat == OutputThreat.PROMPT_LEAK
    assert result.safe_output is None

def test_empty_output_passes():
    canary = generate_canary()
    result = validate_output("", canary)
    assert result.threat == OutputThreat.NONE

def test_oversized_output_truncated():
    canary = generate_canary()
    huge = "x" * 50_001
    result = validate_output(huge, canary)
    assert result.threat == OutputThreat.OVERSIZED
    assert result.safe_output is None

def test_canary_is_unique():
    canaries = {generate_canary() for _ in range(100)}
    assert len(canaries) == 100
