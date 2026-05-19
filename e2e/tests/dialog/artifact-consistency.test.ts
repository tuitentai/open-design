// @vitest-environment node

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { createFakeAgentRuntimes } from '@/fake-agents';
import {
  extractArtifactFromRunEvents,
  persistExtractedArtifact,
  type ProjectFile,
} from '@/vitest/artifacts';
import { requestJson, requestText } from '@/vitest/http';
import { listMessages, saveMessage, type E2eChatMessage } from '@/vitest/messages';
import { readRunEvents, startRun, waitForRunStatus } from '@/vitest/runs';
import { createSmokeSuite } from '@/vitest/smoke-suite';

const PROMPT = 'Create a deterministic smoke artifact';
const FILE_NAME = 'real-daemon-smoke.html';
const HEADING = 'Real Daemon Smoke';

type ProjectResponse = {
  conversationId: string;
  project: {
    id: string;
    metadata?: {
      kind?: string;
    };
    name: string;
  };
};

describe('dialog artifact consistency', () => {
  test('keeps run status, saved message, persisted file metadata, and raw artifact content aligned', async () => {
    const suite = await createSmokeSuite('dialog-artifact-consistency');

    await suite.with.toolsDev(async ({ webUrl }) => {
      const fakeAgents = await createFakeAgentRuntimes({
        root: join(suite.scratchDir, 'fake-agents'),
        runtimeIds: ['codex'],
      });

      await requestJson<{ config: Record<string, unknown> }>(webUrl, '/api/app-config', {
        body: {
          agentCliEnv: { codex: fakeAgents.codex.env },
          agentId: 'codex',
          agentModels: { codex: { model: 'default', reasoning: 'default' } },
          designSystemId: null,
          onboardingCompleted: true,
          skillId: null,
          telemetry: { artifactManifest: true, content: false, metrics: false },
        },
        method: 'PUT',
      });

      const project = await requestJson<ProjectResponse>(webUrl, '/api/projects', {
        body: {
          designSystemId: null,
          id: randomUUID(),
          metadata: { kind: 'prototype' },
          name: 'Dialog artifact consistency project',
          pendingPrompt: null,
          skillId: null,
        },
      });

      const now = Date.now();
      const userMessageId = `user-${now}`;
      const assistantMessageId = `assistant-${now}`;
      await saveMessage(webUrl, project.project.id, project.conversationId, {
        content: PROMPT,
        createdAt: now,
        id: userMessageId,
        role: 'user',
      });
      await saveMessage(webUrl, project.project.id, project.conversationId, {
        agentId: 'codex',
        agentName: 'Codex',
        content: '',
        createdAt: now,
        events: [],
        id: assistantMessageId,
        role: 'assistant',
        runStatus: 'running',
        startedAt: now,
      });

      const run = await startRun(webUrl, {
        agentId: 'codex',
        assistantMessageId,
        clientRequestId: `artifact-consistency-${now}`,
        conversationId: project.conversationId,
        designSystemId: null,
        message: PROMPT,
        model: 'default',
        projectId: project.project.id,
        reasoning: 'default',
        skillId: null,
      });

      const finalRun = await waitForRunStatus(webUrl, run.runId, 'succeeded', { timeoutMs: 30_000 });
      const events = await readRunEvents(webUrl, run.runId);
      const artifact = extractArtifactFromRunEvents(events);
      const persistedFile = await persistExtractedArtifact(webUrl, project.project.id, artifact, {
        designSystemId: null,
        sourceSkillId: null,
      });
      await saveMessage(webUrl, project.project.id, project.conversationId, {
        agentId: 'codex',
        agentName: 'Codex',
        content: artifact.rawText,
        createdAt: now,
        endedAt: Date.now(),
        events: [],
        id: assistantMessageId,
        producedFiles: [persistedFile],
        role: 'assistant',
        runId: finalRun.id,
        runStatus: 'succeeded',
        startedAt: now,
        telemetryFinalized: true,
      });

      expect(finalRun.assistantMessageId).toBe(assistantMessageId);
      expect(finalRun.projectId).toBe(project.project.id);
      expect(persistedFile.name).toBe(FILE_NAME);
      expect(persistedFile.kind).toBe('html');
      expect(persistedFile.artifactManifest?.title).toBe(HEADING);
      expect(persistedFile.artifactManifest?.entry).toBe(FILE_NAME);
      expect(persistedFile.artifactManifest?.renderer).toBe('html');
      expect(persistedFile.artifactManifest?.metadata).toEqual(
        expect.objectContaining({
          artifactType: 'text/html',
          identifier: 'real-daemon-smoke',
          inferred: false,
        }),
      );

      const listedMessages = await listMessages(webUrl, project.project.id, project.conversationId);
      const assistant = listedMessages.find((message) => message.id === assistantMessageId);
      assertAssistantMessage(assistant);
      expect(assistant.runStatus).toBe('succeeded');
      expect(assistant.runId).toBe(finalRun.id);
      expect(assistant.producedFiles).toEqual([
        expect.objectContaining({
          artifactManifest: expect.objectContaining({
            entry: FILE_NAME,
            renderer: 'html',
            title: HEADING,
          }),
          name: FILE_NAME,
        }),
      ]);

      const fileListResponse = await requestJson<{ files: ProjectFile[] }>(
        webUrl,
        `/api/projects/${encodeURIComponent(project.project.id)}/files`,
      );
      expect(fileListResponse.files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            artifactManifest: expect.objectContaining({
              entry: FILE_NAME,
              renderer: 'html',
              title: HEADING,
            }),
            kind: 'html',
            name: FILE_NAME,
          }),
        ]),
      );

      const rawHtml = await requestText(
        webUrl,
        `/api/projects/${encodeURIComponent(project.project.id)}/files/${FILE_NAME}`,
      );
      expect(rawHtml).toContain(HEADING);
      expect(rawHtml).toContain('Generated through the daemon run path.');

      await suite.report.json('summary.json', {
        assistantMessageId,
        conversationId: project.conversationId,
        file: persistedFile,
        listedMessage: assistant,
        listedFiles: fileListResponse.files,
        projectId: project.project.id,
        rawHtml,
        run: finalRun,
      });
    });
  }, 180_000);
});

function assertAssistantMessage(
  value: E2eChatMessage | undefined,
): asserts value is E2eChatMessage {
  expect(value, 'assistant message should exist').toBeDefined();
}
