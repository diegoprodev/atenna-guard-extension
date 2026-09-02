import httpx

_FALLBACK = 5.06

async def get_usd_brl() -> float:
    try:
        async with httpx.AsyncClient(timeout=4.0) as c:
            r = await c.get('https://api.frankfurter.app/latest?from=USD&to=BRL')
            if r.is_success:
                rate = r.json().get('rates', {}).get('BRL')
                if rate:
                    return float(rate)
    except Exception:
        pass
    return _FALLBACK
