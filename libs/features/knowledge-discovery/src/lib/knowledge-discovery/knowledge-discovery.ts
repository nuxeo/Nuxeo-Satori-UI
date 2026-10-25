import { DatePipe, JsonPipe } from '@angular/common';
import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute } from '@angular/router';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { Subscription, catchError, forkJoin, map, of, switchMap, timer } from 'rxjs';

import { ContentLakeUploadComponent } from '../content-lake-upload/content-lake-upload';
import { KdCitationDialogComponent } from '../kd-citation-dialog/kd-citation-dialog';
import {
  KdClientService,
  KdDiscoveryError,
  buildIndexedReferences,
  parseAnswerSegments,
  type KdAgentDetails,
  type KdAgentSummary,
  type KdAnswerResponse,
  type KdAnswerSegment,
  type KdFeedbackValue,
  type KdGuardrail,
  type KdModelInfo,
  type KdQuestionHistoryItem,
} from '@agentic-ui/shared/kd-client';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

/**
 * Structured snapshot of a failed KD HTTP call, surfaced inline on the page
 * when `?debug=1` is in the URL. Lets a Nuxeo Cloud admin triage banner
 * errors without opening DevTools — useful on hosted envs where the
 * Console "Logs" panel is empty after a RESET NODES task.
 */
export interface KdDebugError {
  operation: string;
  url?: string;
  status?: number;
  statusText?: string;
  body: unknown;
  message: string;
  timestamp: string;
}

/**
 * Consumer-facing Knowledge Discovery page.
 *
 * Agent management (create/edit/delete) deliberately lives outside of this
 * app: the Hyland Content Intelligence Connector exposes only read/invoke
 * operations (no CRUD) and the upstream Discovery API rejects agent create
 * requests over the connector's auth. Users manage agents in the Hyland
 * Insight admin UI; we just pick one, ask questions, and render the answer.
 */
@Component({
  selector: 'lib-knowledge-discovery',
  standalone: true,
  imports: [
    TranslatePipe,
    DatePipe,
    FormsModule,
    JsonPipe,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    SAT_BANNER_IMPORTS,
  ],
  templateUrl: './knowledge-discovery.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './knowledge-discovery.scss',
})
export class KnowledgeDiscoveryComponent {
  private readonly kdClient = inject(KdClientService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly dialog = inject(MatDialog);
  private answerPollSub: Subscription | null = null;
  private readonly insufficientAnswerText =
    "I don't have enough information to answer this question";

  /**
   * Inline-debug toggle. Enabled by `?debug=1` in the URL (`#/knowledge-
   * discovery?debug=1`). When on, the error banners reveal the captured
   * HTTP failure details (status, body) so a Cloud admin can triage
   * without DevTools — handy on hosted envs where the Console Logs panel
   * is empty (e.g. after a RESET NODES task).
   *
   * Sourced from `queryParamMap` (an observable) rather than `snapshot`
   * so toggling `?debug=1` in the address bar is honoured even when the
   * router reuses this component instance — which the default route reuse
   * strategy does whenever only query params change.
   */
  readonly debugMode = toSignal(
    this.route.queryParamMap.pipe(map((qm) => qm.get('debug') === '1')),
    { requireSync: true },
  );

  readonly loadingAgents = signal(false);
  readonly agentsError = signal<string | null>(null);
  readonly agentsErrorDetail = signal<KdDebugError | null>(null);
  readonly agents = signal<KdAgentSummary[]>([]);
  readonly selectedAgentId = signal<string | null>(null);
  readonly selectedAgent = signal<KdAgentDetails | null>(null);
  readonly loadingAgentDetails = signal(false);
  readonly agentDetailsError = signal<string | null>(null);
  readonly agentDetailsErrorDetail = signal<KdDebugError | null>(null);
  readonly models = signal<KdModelInfo[]>([]);
  readonly guardrailGroups = signal<
    { displayName: string; description: string; guardrails: KdGuardrail[] }[]
  >([]);
  readonly loadingReferenceData = signal(false);
  readonly referenceDataError = signal<string | null>(null);
  readonly referenceDataErrorDetail = signal<KdDebugError | null>(null);

  readonly questionText = signal('');
  readonly dynamicFilterText = signal('');
  readonly questionError = signal<string | null>(null);
  readonly submittingQuestion = signal(false);
  readonly activeQuestionId = signal<string | null>(null);
  readonly answer = signal<KdAnswerResponse | null>(null);
  readonly pollingAnswer = signal(false);
  readonly feedbackInFlight = signal<KdFeedbackValue | null>(null);

  readonly history = signal<KdQuestionHistoryItem[]>([]);
  readonly loadingHistory = signal(false);

  readonly hasSelection = computed(() => this.selectedAgentId() !== null);
  readonly isAwaitingResponse = computed(() => this.submittingQuestion() || this.pollingAnswer());
  readonly loadingTitleKey = computed(() =>
    this.submittingQuestion()
      ? 'kd.knowledge-discovery.submitting-your-question'
      : 'kd.knowledge-discovery.generating-answer',
  );
  readonly loadingMessageKey = computed(() =>
    this.submittingQuestion()
      ? 'kd.knowledge-discovery.sending-the-request'
      : 'kd.knowledge-discovery.searching-the-selected-agent',
  );
  readonly canClear = computed(
    () => this.questionText().trim().length > 0 && !this.isAwaitingResponse(),
  );
  readonly canAsk = computed(() => this.hasSelection() && this.canClear());

  clearQuestion(): void {
    this.questionText.set('');
  }

  /**
   * The Discovery API only accepts a `dynamicFilter` on agents that were
   * configured with a `dynamicFilterTemplate`. Sending one on an agent
   * without a template comes back as a hard 400 Bad Request. We therefore
   * only show the Advanced Filter field when the selected agent declares a
   * template.
   */
  readonly agentSupportsDynamicFilter = computed(() => {
    const template = this.selectedAgent()?.dynamicFilterTemplate;
    return template !== null && template !== undefined;
  });

  constructor() {
    this.loadReferenceData();
    this.loadAgents();
  }

  loadReferenceData(): void {
    this.loadingReferenceData.set(true);
    this.referenceDataError.set(null);
    this.referenceDataErrorDetail.set(null);

    forkJoin({
      models: this.kdClient.listModels(),
      guardrails: this.kdClient.listGuardrails(),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ models, guardrails }) => {
          this.models.set(models);
          this.guardrailGroups.set(guardrails.guardrailGroups);
          this.loadingReferenceData.set(false);
        },
        error: (err) => {
          this.referenceDataError.set(
            this.translate.instant('kd.message.failed-to-load-knowledge-discovery-models-and'),
          );
          if (this.debugMode()) {
            this.referenceDataErrorDetail.set(
              this.captureError('listModels + listGuardrails (forkJoin)', err),
            );
          }
          this.loadingReferenceData.set(false);
        },
      });
  }

  loadAgents(selectAgentId?: string): void {
    this.loadingAgents.set(true);
    this.agentsError.set(null);
    this.agentsErrorDetail.set(null);

    this.kdClient
      .listAgents()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (agents) => {
          this.agents.set(agents);
          this.loadingAgents.set(false);

          const nextAgentId = selectAgentId ?? this.selectedAgentId() ?? agents[0]?.id ?? null;
          if (nextAgentId) {
            this.selectAgent(nextAgentId);
          }
        },
        error: (err) => {
          this.agentsError.set(
            err?.error?.detail ??
              this.translate.instant('kd.message.failed-to-load-knowledge-discovery-agents'),
          );
          if (this.debugMode()) {
            this.agentsErrorDetail.set(
              this.captureError('HylandKnowledgeDiscovery.getAllAgents', err),
            );
          }
          this.loadingAgents.set(false);
        },
      });
  }

  selectAgent(agentId: string): void {
    this.stopAnswerPolling();
    this.selectedAgentId.set(agentId);
    this.loadingAgentDetails.set(true);
    this.agentDetailsError.set(null);
    this.agentDetailsErrorDetail.set(null);

    this.kdClient
      .getAgent(agentId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (agent) => {
          this.selectedAgent.set(agent);
          this.loadingAgentDetails.set(false);
          this.loadHistory(agent.id);
        },
        error: (err) => {
          this.agentDetailsError.set(
            err?.error?.detail ?? this.translate.instant('kd.message.failed-to-load-agent-details'),
          );
          if (this.debugMode()) {
            this.agentDetailsErrorDetail.set(
              this.captureError(`HylandKnowledgeDiscovery.Invoke /agent/agents/${agentId}`, err),
            );
          }
          this.loadingAgentDetails.set(false);
        },
      });
  }

  submitQuestion(): void {
    const agentId = this.selectedAgentId();
    const question = this.questionText().trim();
    if (!agentId || !question) return;

    let dynamicFilter: Record<string, unknown> | null = null;
    if (this.agentSupportsDynamicFilter()) {
      try {
        dynamicFilter = this.parseDynamicFilter(this.dynamicFilterText());
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : this.translate.instant('kd.message.dynamic-filter-invalid');
        this.questionError.set(message);
        return;
      }
    }

    this.submittingQuestion.set(true);
    this.questionError.set(null);
    this.answer.set(null);

    this.kdClient
      .submitQuestion({ agentId, question, dynamicFilter })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.activeQuestionId.set(result.questionId);

          const terminalStatuses: KdAnswerResponse['status'][] = ['Complete', 'Error', 'Blocked'];
          if (terminalStatuses.includes(result.status)) {
            this.kdClient
              .getAnswer(result.questionId)
              .pipe(takeUntilDestroyed(this.destroyRef))
              .subscribe({
                next: (answer) => {
                  this.submittingQuestion.set(false);
                  this.answer.set(answer);
                  if (this.selectedAgentId()) {
                    this.loadHistory(this.selectedAgentId() ?? '');
                  }
                },
                error: (err) => {
                  this.submittingQuestion.set(false);
                  this.questionError.set(
                    this.resolveQuestionError(
                      err,
                      this.translate.instant(
                        'kd.message.failed-to-retrieve-the-knowledge-discovery-answer',
                      ),
                    ),
                  );
                },
              });
            return;
          }

          this.submittingQuestion.set(false);
          this.answer.set({
            questionId: result.questionId,
            agentId,
            question,
            status: result.status,
            answer: '',
            citations: [],
          });
          this.pollForAnswer(result.questionId);
        },
        error: (err) => {
          this.questionError.set(
            this.resolveQuestionError(
              err,
              this.translate.instant(
                'kd.message.failed-to-submit-the-knowledge-discovery-question',
              ),
            ),
          );
          this.submittingQuestion.set(false);
        },
      });
  }

  /**
   * Format an error coming back from `KdClientService.submitQuestion`.
   * A 400 on a `dynamicFilter` payload is almost always the template
   * mismatch diagnosed in [docs/knowledge-discovery.md]; we surface that
   * as a targeted hint instead of the generic upstream message.
   */
  private resolveQuestionError(err: unknown, fallback: string): string {
    if (err instanceof KdDiscoveryError) {
      if (err.responseCode === 400) {
        if (this.dynamicFilterText().trim().length > 0) {
          return this.translate.instant('kd.message.dynamic-filter-rejected');
        }
        const agent = this.selectedAgent();
        const model = this.models().find((entry) => entry.modelName === agent?.modelName);
        if (model && model.status && model.status !== 'Active') {
          const params = {
            model: agent?.modelName,
            status: model.status,
            replacement: model.replacementModelName,
          };
          return this.translate.instant(
            model.replacementModelName
              ? 'kd.message.model-inactive-with-replacement'
              : 'kd.message.model-inactive',
            params,
          );
        }
      }
      return this.translate.instant(
        err.responseMessage ? 'kd.message.discovery-error' : 'kd.message.discovery-http-error',
        { code: err.responseCode, message: err.responseMessage },
      );
    }
    const maybeDetail = (err as { error?: { detail?: string }; message?: string } | null)?.error
      ?.detail;
    const maybeMessage = (err as { message?: string } | null)?.message;
    return maybeDetail ?? maybeMessage ?? fallback;
  }

  submitFeedback(feedback: KdFeedbackValue): void {
    const questionId = this.activeQuestionId();
    if (!questionId) return;

    this.feedbackInFlight.set(feedback);
    this.kdClient
      .submitFeedback(questionId, { feedback })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.feedbackInFlight.set(null);
          this.answer.update((current) => (current ? { ...current, feedback } : current));
          if (this.selectedAgentId()) {
            this.loadHistory(this.selectedAgentId() ?? '');
          }
        },
        error: () => {
          this.feedbackInFlight.set(null);
          this.questionError.set(
            this.translate.instant('kd.message.failed-to-submit-knowledge-discovery-feedback'),
          );
        },
      });
  }

  loadHistory(agentId: string): void {
    this.loadingHistory.set(true);
    this.kdClient
      .getQuestionHistory(agentId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (history) => {
          this.history.set(history.data);
          this.loadingHistory.set(false);
        },
        error: () => {
          this.loadingHistory.set(false);
          this.history.set([]);
        },
      });
  }

  private pollForAnswer(questionId: string): void {
    this.stopAnswerPolling();
    this.pollingAnswer.set(true);

    this.answerPollSub = timer(0, 1500)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        switchMap(() =>
          this.kdClient.getAnswer(questionId).pipe(
            catchError((err) => {
              this.questionError.set(
                err?.error?.detail ??
                  this.translate.instant(
                    'kd.message.failed-to-retrieve-the-knowledge-discovery-answer',
                  ),
              );
              this.pollingAnswer.set(false);
              return of(null);
            }),
          ),
        ),
      )
      .subscribe((answer) => {
        if (!answer) return;

        this.answer.set(answer);
        if (['Complete', 'Error', 'Blocked'].includes(answer.status)) {
          this.pollingAnswer.set(false);
          this.stopAnswerPolling();
          if (this.selectedAgentId()) {
            this.loadHistory(this.selectedAgentId() ?? '');
          }
        }
      });
  }

  private stopAnswerPolling(): void {
    this.answerPollSub?.unsubscribe();
    this.answerPollSub = null;
    this.pollingAnswer.set(false);
  }

  openContentLakeUploadDialog(): void {
    this.dialog.open(ContentLakeUploadComponent, {
      width: '520px',
      maxWidth: '95vw',
      autoFocus: 'dialog',
    });
  }

  getAnswerSegments(answer: KdAnswerResponse): KdAnswerSegment[] {
    const formatted = this.formatAnswerText(answer.answer);
    const segments = parseAnswerSegments(formatted);
    if (segments.some((segment) => segment.type === 'citation')) {
      return segments;
    }

    const references = buildIndexedReferences(answer);
    if (references.length === 0) {
      return segments;
    }

    return [
      ...segments,
      { type: 'text', text: ' ' },
      ...references.flatMap((reference, position) =>
        position === 0
          ? [{ type: 'citation' as const, index: reference.index }]
          : [
              { type: 'text' as const, text: ' ' },
              { type: 'citation' as const, index: reference.index },
            ],
      ),
    ];
  }

  openCitationDialog(answer: KdAnswerResponse, citationIndex: number): void {
    this.dialog.open(KdCitationDialogComponent, {
      width: 'min(96vw, 1180px)',
      maxWidth: '96vw',
      maxHeight: '92vh',
      autoFocus: 'dialog',
      panelClass: 'kd-citation-dialog-panel',
      data: {
        answer,
        initialIndex: citationIndex,
      },
    });
  }

  formatAnswerText(answer: string): string {
    const cleaned = answer.replace(/^#{1,6}\s*/gm, '').trim();
    if (!cleaned) return '';
    if (cleaned.toLowerCase() === this.insufficientAnswerText.toLowerCase()) {
      return this.translate.instant('kd.knowledge-discovery.insufficient-answer');
    }
    return cleaned;
  }

  /**
   * Normalise the disparate error shapes that flow through `KdClientService`
   * into a single inspectable record for the debug panel.
   *
   * Two shapes are common:
   *   1. `KdDiscoveryError` — thrown by the CIC envelope unwrap when the
   *      upstream Discovery API returned a non-2xx `responseCode` (the
   *      Nuxeo automation call itself succeeded). `responseCode` is the
   *      upstream HTTP status; `upstreamBody` is the upstream JSON.
   *   2. `HttpErrorResponse`-like — emitted by `HttpClient` when Nuxeo
   *      itself failed (401 session, 404 op-not-found, 502 egress). The
   *      shape varies but typically carries `status`, `statusText`, `url`,
   *      and `error` (parsed JSON if Content-Type allowed, otherwise the
   *      raw response text — often the Nuxeo login HTML for a 401).
   */
  captureError(operation: string, err: unknown): KdDebugError {
    const timestamp = new Date().toISOString();

    if (err instanceof KdDiscoveryError) {
      return {
        operation,
        status: err.responseCode,
        statusText: err.responseMessage,
        body: err.upstreamBody,
        message: err.message,
        timestamp,
      };
    }

    const httpLike = err as {
      status?: number;
      statusText?: string;
      url?: string;
      error?: unknown;
      message?: string;
    } | null;
    return {
      operation,
      url: httpLike?.url ?? undefined,
      status: httpLike?.status,
      statusText: httpLike?.statusText,
      body: httpLike?.error,
      message: httpLike?.message ?? String(err ?? 'Unknown error'),
      timestamp,
    };
  }

  /**
   * Copy a debug capture as pretty JSON to the clipboard. Intended for
   * pasting into a SUPNXP ticket or sharing with the satori-ui team. A
   * `console.error` fallback covers permissionless contexts (e.g. when the
   * Clipboard API is blocked by the iframe sandbox in some Nuxeo embeds).
   */
  copyDebugInfo(detail: KdDebugError): void {
    const payload = JSON.stringify(detail, null, 2);
    const clipboard = (typeof navigator !== 'undefined' ? navigator : undefined)?.clipboard;
    if (clipboard?.writeText) {
      clipboard.writeText(payload).catch(() => console.error('KD debug payload', payload));
      return;
    }
    console.error('KD debug payload', payload);
  }

  private parseDynamicFilter(value: string): Record<string, unknown> | null {
    const trimmed = value.trim();
    if (!trimmed) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error(this.translate.instant('kd.message.dynamic-filter-not-json'));
    }

    if (parsed === null) return null;
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(this.translate.instant('kd.message.dynamic-filter-not-object'));
    }
    return parsed as Record<string, unknown>;
  }
}
