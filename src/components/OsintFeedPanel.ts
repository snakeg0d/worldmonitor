import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import { escapeHtml } from '@/utils/sanitize';
import { formatTime } from '@/utils';
import type { ThreatLevel } from '@/types';

/** A single OSINT channel message. */
export interface OsintMessage {
  id: string;
  channel: string;
  text: string;
  date: Date;
  threatLevel?: ThreatLevel;
}

const THREAT_BADGE_LABELS: Record<ThreatLevel, string> = {
  critical: 'CRITICAL',
  high: 'HIGH',
  medium: 'MED',
  low: 'LOW',
  info: 'INFO',
};

export class OsintFeedPanel extends Panel {
  private messages: OsintMessage[] = [];

  constructor() {
    super({
      id: 'osint-feed',
      title: 'OSINT Feed',
      showCount: true,
      trackActivity: true,
    });
  }

  /** Replace all messages and re-render. */
  public updateMessages(messages: OsintMessage[]): void {
    this.messages = messages;
    this.renderMessages();
  }

  /** Append new messages (dedup by id) and re-render. */
  public appendMessages(incoming: OsintMessage[]): void {
    const existing = new Set(this.messages.map(m => m.id));
    const novel = incoming.filter(m => !existing.has(m.id));
    if (novel.length === 0) return;
    this.messages = [...novel, ...this.messages];
    this.renderMessages();
  }

  private renderMessages(): void {
    if (this.messages.length === 0) {
      this.setDataBadge('unavailable');
      this.setCount(0);
      replaceChildren(
        this.content,
        h('div', { className: 'panel-empty osint-empty' },
          h('div', { className: 'osint-empty-icon' }, '📡'),
          h('div', null, 'No OSINT messages yet'),
        ),
      );
      return;
    }

    this.setDataBadge('live');
    this.setCount(this.messages.length);

    // Sort newest first
    const sorted = [...this.messages].sort(
      (a, b) => b.date.getTime() - a.date.getTime(),
    );

    replaceChildren(
      this.content,
      h('div', { className: 'osint-feed-list' },
        ...sorted.map(msg => this.buildMessageCard(msg)),
      ),
    );
  }

  private buildMessageCard(msg: OsintMessage): HTMLElement {
    const threatClass = msg.threatLevel ? `osint-threat-${msg.threatLevel}` : '';

    return h('div', { className: `osint-message ${threatClass}`.trim(), dataset: { msgId: msg.id } },
      h('div', { className: 'osint-message-header' },
        h('span', { className: 'osint-source' }, escapeHtml(msg.channel)),
        msg.threatLevel
          ? h('span', {
              className: `osint-threat-badge threat-${msg.threatLevel}`,
            }, THREAT_BADGE_LABELS[msg.threatLevel])
          : false,
        h('span', { className: 'osint-time' }, formatTime(msg.date)),
      ),
      h('div', { className: 'osint-message-text' }, escapeHtml(msg.text)),
    );
  }
}
