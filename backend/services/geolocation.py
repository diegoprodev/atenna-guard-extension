"""
Geolocation service — detect country from IP and store in user_locations.
Supports: BR, US, GB, EU (rest of Europe), AR.
"""
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Country code to currency mapping
COUNTRY_CURRENCY_MAP = {
    'BR': {'currency': 'BRL', 'timezone': 'America/Sao_Paulo'},
    'US': {'currency': 'USD', 'timezone': 'America/New_York'},
    'GB': {'currency': 'GBP', 'timezone': 'Europe/London'},
    'EU': {'currency': 'EUR', 'timezone': 'Europe/London'},
    'AR': {'currency': 'ARS', 'timezone': 'America/Argentina/Buenos_Aires'},
}

def get_country_from_ip(ip: str, client=None) -> dict:
    """
    Detect country from IP address.
    Returns dict with country, currency, timezone.
    """
    if not ip or ip == '127.0.0.1' or ip.startswith('192.168'):
        # Fallback for local/test IPs
        return {'country': 'US', 'currency': 'USD', 'timezone': 'America/New_York'}

    try:
        # Try using geoip2 if available
        import geoip2.database
        reader = geoip2.database.Reader('/usr/share/GeoIP/GeoLite2-Country.mmdb')
        response = reader.country(ip)
        country_iso = response.country.iso_code

        # Map ISO codes to our supported countries
        if country_iso == 'BR':
            country = 'BR'
        elif country_iso == 'US':
            country = 'US'
        elif country_iso == 'GB':
            country = 'GB'
        elif country_iso == 'AR':
            country = 'AR'
        else:
            # Default Europe to EU
            country = 'EU' if response.continent.code == 'EU' else 'US'

        return {
            'country': country,
            'currency': COUNTRY_CURRENCY_MAP[country]['currency'],
            'timezone': COUNTRY_CURRENCY_MAP[country]['timezone'],
        }
    except Exception as e:
        logger.debug(f'geoip2 lookup failed for {ip}: {e}')

    # Fallback: simple IP range mapping
    ip_parts = ip.split('.')
    if len(ip_parts) >= 1:
        first_octet = int(ip_parts[0])

        # Rough IP ranges (MVP only)
        if first_octet in range(177, 180):  # Brazil
            country = 'BR'
        elif first_octet in range(82, 85):  # UK
            country = 'GB'
        elif first_octet in range(181, 184):  # Argentina
            country = 'AR'
        else:
            country = 'US'  # Default
    else:
        country = 'US'

    return {
        'country': country,
        'currency': COUNTRY_CURRENCY_MAP[country]['currency'],
        'timezone': COUNTRY_CURRENCY_MAP[country]['timezone'],
    }

def cache_user_location(user_id: str, country: str, client=None):
    """Cache user location in Supabase user_locations table."""
    if not client:
        from services.supabase_admin import get_admin_client
        client = get_admin_client()

    try:
        # Check if record exists
        existing = client.table('user_locations').select('*').eq('user_id', user_id).execute()

        if existing.data:
            # Update
            client.table('user_locations').update({'country': country, 'updated_at': 'now()'}).eq('user_id', user_id).execute()
        else:
            # Insert
            client.table('user_locations').insert({
                'user_id': user_id,
                'country': country,
            }).execute()
    except Exception as e:
        logger.warning(f'Failed to cache location for {user_id}: {e}')

def get_cached_country(user_id: str, client=None) -> Optional[str]:
    """Retrieve cached country for user."""
    if not client:
        from services.supabase_admin import get_admin_client
        client = get_admin_client()

    try:
        result = client.table('user_locations').select('country').eq('user_id', user_id).single().execute()
        if result.data:
            return result.data.get('country')
    except Exception as e:
        logger.debug(f'Failed to get cached country for {user_id}: {e}')

    return None
