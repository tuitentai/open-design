import { describe, expect, it } from 'vitest';
import { diagnoseClaudeCliFailure } from '../src/claude-diagnostics.js';

describe('diagnoseClaudeCliFailure', () => {
  it('maps Claude auth failures to /login guidance', () => {
    const diagnostic = diagnoseClaudeCliFailure({
      agentId: 'claude',
      exitCode: 1,
      stderrTail: '{"apiKeySource":"none","error_status":401}',
      env: {},
    });

    expect(diagnostic?.message).toContain('/login');
    expect(diagnostic?.detail).toContain('CLAUDE_CONFIG_DIR');
  });

  it('maps custom endpoint model access failures to endpoint guidance', () => {
    const diagnostic = diagnoseClaudeCliFailure({
      agentId: 'claude',
      exitCode: 1,
      stderrTail:
        'Error: The selected model is not available in your current plan or region.',
      env: { ANTHROPIC_BASE_URL: 'https://proxy.example.com' },
    });

    expect(diagnostic?.message).toContain('custom endpoint');
    expect(diagnostic?.detail).toContain('ANTHROPIC_BASE_URL');
  });

  it('maps custom endpoint auth failures to endpoint credential guidance', () => {
    const diagnostic = diagnoseClaudeCliFailure({
      agentId: 'claude',
      exitCode: 1,
      stderrTail: '{"apiKeySource":"none","error_status":401}',
      env: { ANTHROPIC_BASE_URL: 'https://proxy.example.com' },
    });

    expect(diagnostic?.message).toContain('custom Anthropic endpoint');
    expect(diagnostic?.detail).toContain('ANTHROPIC_BASE_URL');
    expect(diagnostic?.detail).toContain('proxy credentials');
    expect(diagnostic?.detail).not.toContain('use `/login`');
  });

  it('maps silent custom endpoint exits to endpoint guidance', () => {
    const diagnostic = diagnoseClaudeCliFailure({
      agentId: 'claude',
      exitCode: 1,
      stderrTail: '',
      stdoutTail: '',
      env: { ANTHROPIC_BASE_URL: 'https://proxy.example.com' },
    });

    expect(diagnostic?.message).toContain('custom Anthropic endpoint');
    expect(diagnostic?.detail).toContain('ANTHROPIC_BASE_URL');
    expect(diagnostic?.detail).toContain('proxy credentials');
    expect(diagnostic?.detail).not.toContain('use `/login`');
  });

  it('includes configured Claude config directory context', () => {
    const diagnostic = diagnoseClaudeCliFailure({
      agentId: 'claude',
      exitCode: 1,
      stderrTail: 'Authentication failed: token expired',
      env: { CLAUDE_CONFIG_DIR: '/tmp/claude-alt' },
    });

    expect(diagnostic?.detail).toContain('Effective CLAUDE_CONFIG_DIR: /tmp/claude-alt');
  });

  it('does not classify unrelated non-Claude failures', () => {
    const diagnostic = diagnoseClaudeCliFailure({
      agentId: 'codex',
      exitCode: 1,
      stderrTail: 'Authentication failed',
      env: {},
    });

    expect(diagnostic).toBeNull();
  });

  it('redacts token-like text from returned details', () => {
    const diagnostic = diagnoseClaudeCliFailure({
      agentId: 'claude',
      exitCode: 1,
      stderrTail: '401 Authorization: Bearer abcdef0123456789ABCDEF==',
      env: {},
    });

    expect(diagnostic?.detail).not.toContain('abcdef0123456789ABCDEF');
    expect(diagnostic?.detail).toContain('[REDACTED:bearer_token]');
  });

  it('redacts provider header and query API keys from returned details', () => {
    const diagnostic = diagnoseClaudeCliFailure({
      agentId: 'claude',
      exitCode: 1,
      stderrTail:
        '401 x-api-key: header-secret-123 url=https://proxy.example.test/v1?key=query-secret-456',
      env: { ANTHROPIC_BASE_URL: 'https://proxy.example.test' },
    });

    expect(diagnostic?.detail).not.toContain('header-secret-123');
    expect(diagnostic?.detail).not.toContain('query-secret-456');
    expect(diagnostic?.detail).toContain('x-api-key: [REDACTED:api_key_header]');
    expect(diagnostic?.detail).toContain('?key=[REDACTED:api_key_query]');
  });
});
