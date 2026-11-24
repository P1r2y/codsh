import usageModel from '../usage-model.cjs';

export const fmt = n => n == null || !Number.isFinite(n) ? '—' : n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n/1e3)}K` : Math.round(n).toLocaleString('en-US');
export const pct = n => n == null ? '—' : `${Math.round(n)}%`;
export const elapsed = ms => ms == null ? '—' : ms >= 60000 ? `${(ms/60000).toFixed(1)} 分钟` : `${(ms/1000).toFixed(1)} 秒`;
export const tokens = n => n == null ? '暂无数据' : `${Math.round(n).toLocaleString('en-US')} tok`;
export const completedDate = turn => turn?.completedAt ? new Date(turn.completedAt).toLocaleString('zh-CN', {timeZone:'Asia/Shanghai',year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}) : null;
export const speedLabel = turn => turn?.estimatedGenerationTps != null ? `${Math.round(turn.estimatedGenerationTps)} tok/s` : turn?.averageTps != null ? `整轮 ${turn.averageTps.toFixed(1)} tok/s` : '速度 —';

// Between usage revisions only the live turn's clock advances.
export function sessionSpeedReader(turns) {
  const stats = usageModel.statisticsFor(turns), label = speedLabel(stats), last = turns.at(-1);
  if (!last || last.completed || stats.estimatedGenerationTps != null) return () => label;
  let historyMs = 0, output = last.usage?.output_tokens ?? 0;
  for (let i=0; i<turns.length-1; i++) {
    const turn = turns[i];
    if (turn.durationMs == null) return () => label;
    historyMs += turn.durationMs;
    output += turn.usage?.output_tokens ?? 0;
  }
  return () => {
    const duration = last.durationMs == null ? null : historyMs + last.durationMs;
    return speedLabel({averageTps:duration > 0 && output > 0 ? output * 1000 / duration : null});
  };
}

export function countdown(ms) {
  if (ms == null || !Number.isFinite(ms)) return '重置时间不可用';
  if (ms <= 0) return '等待刷新';
  const m = Math.ceil(ms/60000), d = Math.floor(m/1440), h = Math.floor(m%1440/60);
  return d ? `${d}天 ${h}小时` : h ? `${h}小时 ${m%60}分` : `${m}分`;
}
