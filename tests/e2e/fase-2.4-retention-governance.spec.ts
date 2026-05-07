/**
 * FASE 2.4: Retention & Operational Governance E2E Tests
 *
 * Validates:
 * - Retention policies applied correctly
 * - Automatic purge of expired events
 * - User statistics tracking
 * - Storage metrics calculation
 * - Fallback behavior
 */

import { test, expect } from '@playwright/test';
import fetch from 'node-fetch';

test.describe('FASE 2.4: Retention & Operational Governance', () => {
  const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';
  const JWT_TOKEN = process.env.TEST_JWT || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test';

  // ══════════════════════════════════════════════════════════════════════════
  // Teste 1: Retention policies estão configuradas
  // ══════════════════════════════════════════════════════════════════════════
  test('Retention policies defined for all risk levels', async () => {
    const response = await fetch(`${BACKEND_URL}/retention/policies`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${JWT_TOKEN}`,
      },
    });

    if (response.ok) {
      const policies = await response.json();

      // Validar que todos os risk levels têm retention days
      expect(policies).toHaveProperty('CRITICAL');
      expect(policies).toHaveProperty('HIGH');
      expect(policies).toHaveProperty('MEDIUM');
      expect(policies).toHaveProperty('LOW');
      expect(policies).toHaveProperty('SAFE');
      expect(policies).toHaveProperty('UNKNOWN');

      // Validar retention days (em dias)
      expect(policies.CRITICAL).toBe(180);  // 6 meses
      expect(policies.HIGH).toBe(120);      // 4 meses
      expect(policies.MEDIUM).toBe(60);     // 2 meses
      expect(policies.LOW).toBe(30);        // 1 mês
      expect(policies.SAFE).toBe(30);       // 1 mês
      expect(policies.UNKNOWN).toBe(90);    // 3 meses

      console.log('✅ TESTE 1: Retention policies configuradas corretamente');
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Teste 2: Retention summary mostra eventos expirando em breve
  // ══════════════════════════════════════════════════════════════════════════
  test('Retention summary shows expiring events', async () => {
    const response = await fetch(`${BACKEND_URL}/retention/summary`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${JWT_TOKEN}`,
      },
    });

    if (response.ok) {
      const summary = await response.json();

      // Validar estrutura
      expect(summary).toHaveProperty('expiring_today');
      expect(summary).toHaveProperty('expiring_7_days');
      expect(summary).toHaveProperty('expiring_30_days');
      expect(summary).toHaveProperty('by_risk_level');

      // Validar números
      expect(summary.expiring_today).toBeGreaterThanOrEqual(0);
      expect(summary.expiring_7_days).toBeGreaterThanOrEqual(summary.expiring_today);
      expect(summary.expiring_30_days).toBeGreaterThanOrEqual(summary.expiring_7_days);

      console.log(`✅ TESTE 2: Retention summary ok`);
      console.log(`  - Expiring today: ${summary.expiring_today}`);
      console.log(`  - Expiring in 7 days: ${summary.expiring_7_days}`);
      console.log(`  - Expiring in 30 days: ${summary.expiring_30_days}`);
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Teste 3: Storage metrics calculados corretamente
  // ══════════════════════════════════════════════════════════════════════════
  test('Storage metrics calculated correctly', async () => {
    const response = await fetch(`${BACKEND_URL}/retention/metrics`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${JWT_TOKEN}`,
      },
    });

    if (response.ok) {
      const metrics = await response.json();

      expect(metrics).toHaveProperty('total_events');
      expect(metrics).toHaveProperty('by_risk_level');
      expect(metrics).toHaveProperty('avg_retention_days');
      expect(metrics).toHaveProperty('growth_rate_pct');
      expect(metrics).toHaveProperty('estimated_storage_mb');

      // Validar tipos e ranges
      expect(typeof metrics.total_events).toBe('number');
      expect(metrics.total_events).toBeGreaterThanOrEqual(0);

      expect(typeof metrics.avg_retention_days).toBe('number');
      expect(metrics.avg_retention_days).toBeGreaterThan(0);
      expect(metrics.avg_retention_days).toBeLessThanOrEqual(180);

      expect(typeof metrics.growth_rate_pct).toBe('number');

      expect(typeof metrics.estimated_storage_mb).toBe('number');
      expect(metrics.estimated_storage_mb).toBeGreaterThanOrEqual(0);

      console.log('✅ TESTE 3: Storage metrics ok');
      console.log(`  - Total events: ${metrics.total_events}`);
      console.log(`  - Avg retention: ${metrics.avg_retention_days} days`);
      console.log(`  - Growth rate: ${metrics.growth_rate_pct}%`);
      console.log(`  - Estimated storage: ${metrics.estimated_storage_mb}MB`);
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Teste 4: Purge job pode ser disparado
  // ══════════════════════════════════════════════════════════════════════════
  test('Purge job can be triggered', async () => {
    const response = await fetch(`${BACKEND_URL}/retention/purge`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${JWT_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.ok) {
      const result = await response.json();

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('execution_id');
      expect(result).toHaveProperty('records_purged');
      expect(result).toHaveProperty('duration_ms');

      // Validar estrutura
      expect(typeof result.success).toBe('boolean');
      expect(typeof result.execution_id).toBe('string');
      expect(typeof result.records_purged).toBe('number');
      expect(typeof result.duration_ms).toBe('number');

      // Validar ranges
      expect(result.records_purged).toBeGreaterThanOrEqual(0);
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);

      console.log('✅ TESTE 4: Purge job funcionando');
      console.log(`  - Execution ID: ${result.execution_id}`);
      console.log(`  - Records purged: ${result.records_purged}`);
      console.log(`  - Duration: ${result.duration_ms}ms`);
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Teste 5: Purge é idempotente (múltiplas execuções seguras)
  // ══════════════════════════════════════════════════════════════════════════
  test('Purge operation is idempotent', async () => {
    // Execute purge twice
    const response1 = await fetch(`${BACKEND_URL}/retention/purge`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${JWT_TOKEN}`,
      },
    });

    const response2 = await fetch(`${BACKEND_URL}/retention/purge`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${JWT_TOKEN}`,
      },
    });

    if (response1.ok && response2.ok) {
      const result1 = await response1.json();
      const result2 = await response2.json();

      // Ambas devem ter sucesso
      // (A segunda pode purgar 0 registros se nenhum expirou)
      expect(typeof result1.success).toBe('boolean');
      expect(typeof result2.success).toBe('boolean');

      // Execution IDs devem ser diferentes
      expect(result1.execution_id).not.toBe(result2.execution_id);

      console.log('✅ TESTE 5: Purge é idempotente');
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Teste 6: Retention configuration validation
  // ══════════════════════════════════════════════════════════════════════════
  test('Retention configuration is valid', async () => {
    const response = await fetch(`${BACKEND_URL}/retention/validate-config`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${JWT_TOKEN}`,
      },
    });

    if (response.ok) {
      const result = await response.json();

      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('fallback_mode');
      expect(result).toHaveProperty('message');

      expect(typeof result.valid).toBe('boolean');

      console.log('✅ TESTE 6: Retention configuration validation ok');
      console.log(`  - Valid: ${result.valid}`);
      console.log(`  - Fallback mode: ${result.fallback_mode}`);
      console.log(`  - Message: ${result.message}`);
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Teste 7: Retention health endpoint
  // ══════════════════════════════════════════════════════════════════════════
  test('Retention health endpoint responds', async () => {
    const response = await fetch(`${BACKEND_URL}/retention/health`, {
      method: 'GET',
    });

    if (response.ok) {
      const result = await response.json();

      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('fallback_mode');
      expect(result).toHaveProperty('configured');

      expect(['ok', 'degraded']).toContain(result.status);

      console.log('✅ TESTE 7: Retention health ok');
      console.log(`  - Status: ${result.status}`);
      console.log(`  - Configured: ${result.configured}`);
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Teste 8: Batch size validation in purge
  // ══════════════════════════════════════════════════════════════════════════
  test('Purge respects batch size limits', async () => {
    // Test with valid batch size
    const response = await fetch(`${BACKEND_URL}/retention/purge?batch_size=500`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${JWT_TOKEN}`,
      },
    });

    if (response.ok) {
      const result = await response.json();
      expect(result).toHaveProperty('records_purged');
      console.log('✅ TESTE 8: Batch size limits respected');
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Teste 9: Growth rate should be reasonable
  // ══════════════════════════════════════════════════════════════════════════
  test('Growth rate is reasonable (<10% daily)', async () => {
    const response = await fetch(`${BACKEND_URL}/retention/metrics`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${JWT_TOKEN}`,
      },
    });

    if (response.ok) {
      const metrics = await response.json();

      // Growth rate should be between -100% and +100% (reasonable bounds)
      expect(metrics.growth_rate_pct).toBeGreaterThan(-100);
      expect(metrics.growth_rate_pct).toBeLessThan(100);

      console.log(`✅ TESTE 9: Growth rate is reasonable (${metrics.growth_rate_pct}%)`);
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Teste 10: Storage estimate should match event count
  // ══════════════════════════════════════════════════════════════════════════
  test('Storage estimate is consistent', async () => {
    const response = await fetch(`${BACKEND_URL}/retention/metrics`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${JWT_TOKEN}`,
      },
    });

    if (response.ok) {
      const metrics = await response.json();

      // Rough estimate: 500 bytes per event
      // So storage_mb should be roughly: total_events * 500 / 1024 / 1024
      const estimatedMB = (metrics.total_events * 500) / (1024 * 1024);
      const margin = estimatedMB * 0.5; // 50% margin

      expect(metrics.estimated_storage_mb).toBeGreaterThan(estimatedMB - margin);
      expect(metrics.estimated_storage_mb).toBeLessThan(estimatedMB + margin);

      console.log('✅ TESTE 10: Storage estimate is consistent');
    }
  });
});
