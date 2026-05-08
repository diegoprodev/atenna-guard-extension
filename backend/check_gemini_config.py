#!/usr/bin/env python
"""Quick check: Is GEMINI_API_KEY configured?"""
import os
from dotenv import load_dotenv

load_dotenv()

key = os.getenv("GEMINI_API_KEY", "")
print("\n=== GEMINI API Configuration Check ===\n")
print(f"GEMINI_API_KEY configured: {'YES' if key and key != 'cole_sua_chave_aqui' else 'NO'}")

if not key:
    print("Status: EMPTY - No API key found in .env")
    print("\nFIX: Add GEMINI_API_KEY=your_key_here to .env file")
elif key == "cole_sua_chave_aqui":
    print("Status: PLACEHOLDER - Key is the default placeholder")
    print("\nFIX: Replace 'cole_sua_chave_aqui' with your actual Gemini API key")
else:
    print(f"Status: CONFIGURED")
    print(f"Key (first 30 chars): {key[:30]}...")
    print("\nThe API should work correctly.")
    print("If prompts still show fallback, the API may be:")
    print("  - Rate limited")
    print("  - Temporarily down")
    print("  - Returning invalid JSON")

print("\n" + "="*40)
