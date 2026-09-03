#!/usr/bin/env python3
"""
One-shot: reconcilia o drift de plano entre profiles / user_plans.
Fonte da verdade = user_plans (mais atual — é o que o get_user_plan lê primeiro).
Idempotente. Rodar 2× = no-op.

    python scripts/reconcile_plans.py            # dry-run (só mostra)
    python scripts/reconcile_plans.py --apply    # aplica
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from routes.subscription_health import reconcile  # noqa: E402


def main() -> int:
    apply = "--apply" in sys.argv
    r = reconcile(dry_run=not apply)
    if not r.get("ok"):
        print("FALHOU:", r)
        return 1
    print(f"{'APLICADO' if apply else 'DRY-RUN'} — {r['n']} mudança(s):")
    for c in r["changes"]:
        print(f"  {c['user']}  {c['de']} -> {c['para']}")
    if not apply and r["n"]:
        print("\nrode de novo com --apply para aplicar")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
