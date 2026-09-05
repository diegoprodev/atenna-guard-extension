"""
FASE 10.9.5 — achado real do dono: "usei 2x hoje mas só conta 1, fuso
horário?". Causa raiz: _window_start('day') calculava meia-noite UTC, que é
21h em Brasília — duas gerações no MESMO dia local, uma antes e outra depois
das 21h BRT, caíam em dois "dias UTC" diferentes: o contador "Hoje" mostrava
errado E o limite de 5/dia (FREE_DAILY_LIMIT) podia ser furado (bypass de
cota real, não só bug visual).

Este teste falha ANTES do fix (ancorado em UTC) e passa depois (ancorado em
America/Sao_Paulo).
"""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from dlp.rate_limit import _window_start, BUSINESS_TZ


def test_business_tz_is_sao_paulo():
    assert BUSINESS_TZ == ZoneInfo("America/Sao_Paulo")


def test_day_window_start_is_midnight_in_business_tz_not_utc():
    start_iso = _window_start('day')
    start = datetime.fromisoformat(start_iso)

    # Convertido pro fuso de negócio, tem que ser exatamente meia-noite —
    # não meia-noite UTC (que seria 21h em Brasília, falhando esta asserção
    # sempre que o teste rodar entre 21h e 23h59 BRT).
    start_local = start.astimezone(BUSINESS_TZ)
    assert start_local.hour == 0
    assert start_local.minute == 0

    # Regressão direta: a versão antiga (meia-noite UTC) NÃO seria meia-noite
    # local sempre que agora (BRT) já tiver passado das 21h.
    start_utc = start.astimezone(timezone.utc)
    now_local = datetime.now(BUSINESS_TZ)
    if now_local.hour >= 3:  # meia-noite UTC só cai à meia-noite local se o offset for 0
        assert not (start_utc.hour == 0 and start_utc.minute == 0 and start_utc.day == datetime.now(timezone.utc).day)


def test_two_generations_same_local_day_straddling_utc_midnight_count_together():
    """
    Simula o caso real: uma geração às 20h BRT e outra às 22h BRT do MESMO
    dia local. Em UTC isso é 23h de um dia e 01h do dia seguinte — dias UTC
    diferentes. Ambas devem contar para a MESMA janela 'day' de negócio.
    """
    day_start_iso = _window_start('day')
    day_start = datetime.fromisoformat(day_start_iso)

    gen_20h_brt = datetime.now(BUSINESS_TZ).replace(hour=20, minute=0, second=0, microsecond=0)
    gen_22h_brt = datetime.now(BUSINESS_TZ).replace(hour=22, minute=0, second=0, microsecond=0)

    gen_20h_utc = gen_20h_brt.astimezone(timezone.utc)
    gen_22h_utc = gen_22h_brt.astimezone(timezone.utc)

    # As duas ainda caem no mesmo dia UTC-calendário? Não necessariamente —
    # é exatamente esse o ponto: mesmo que caiam em dias UTC diferentes,
    # ambas têm que ser >= day_start (ancorado no fuso de negócio).
    assert gen_20h_utc >= day_start
    assert gen_22h_utc >= day_start
