'use strict';

const { number, clamp } = require('./usage-model.cjs');
const time = value => typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : Date.parse(value);

function normalizeLimits(raw, observedAt = Date.now()) {
  if (!raw) return null;
  const groups = raw.rateLimitsByLimitId ?? raw.rate_limits_by_limit_id;
  const candidates = groups ? Object.values(groups) : [raw.rateLimits ?? raw.rate_limits ?? raw];
  const groupsOut = candidates.filter(Boolean).map(group => {
    const windows = ['primary', 'secondary'].flatMap(kind => {
      const window = group[kind]; if (!window) return [];
      const used = number(window.usedPercent ?? window.used_percent);
      const minutes = number(window.windowDurationMins ?? window.window_minutes);
      const resetsAt = number(window.resetsAt ?? window.resets_at);
      if (used === null || minutes === null || minutes === 0) return [];
      return [{kind, usedPercent:clamp(used), remainingPercent:clamp(100-used), windowMinutes:minutes,
        resetsAt:resetsAt === null ? null : time(resetsAt),
        label:minutes === 10080 ? '周额度' : minutes === 300 ? '5 小时额度' : `${minutes / 60} 小时额度`}];
    });
    return {id:group.limitId ?? group.limit_id ?? 'codex', name:group.limitName ?? group.limit_name ?? 'Codex', windows};
  }).filter(group => group.windows.length);
  return groupsOut.length ? {groups:groupsOut, observedAt} : null;
}

function quotaWindow(limits, now = Date.now()) {
  const windows = limits?.groups?.flatMap(group => group.windows.map(window => ({...window, groupName:group.name}))) ?? [];
  const current = windows.filter(window => window.resetsAt == null || window.resetsAt > now);
  return (current.length ? current : windows).sort((a, b) => a.remainingPercent-b.remainingPercent || a.windowMinutes-b.windowMinutes)[0] ?? null;
}

module.exports = { normalizeLimits, quotaWindow };
