<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { listAiUsage, type AiUsageRecord, type Project } from '../lib/projectStore';

const props = defineProps<{ projects: Project[] }>();
const records = ref<AiUsageRecord[]>([]);
const selectedProject = ref('');
const busy = ref(false);
const error = ref('');
const number = new Intl.NumberFormat('en-US');
const projectNames = computed(() => {
  const names = new Map(records.value.map(record => [record.projectId, record.projectName]));
  for (const project of props.projects) names.set(project.id, project.name);
  return names;
});
const projectOptions = computed(() => [...projectNames.value].sort((a, b) => a[1].localeCompare(b[1])));
const visible = computed(() => selectedProject.value ? records.value.filter(record => record.projectId === selectedProject.value) : records.value);
function sum(rows: AiUsageRecord[], field: 'promptTokens' | 'completionTokens' | 'totalTokens' | 'cachedPromptTokens') {
  return rows.reduce((total, row) => total + (row[field] ?? 0), 0);
}
function summary(rows: AiUsageRecord[]) { return { requests: rows.length, errors: rows.filter(row => row.status === 'error').length,
  prompt: sum(rows, 'promptTokens'), completion: sum(rows, 'completionTokens'), total: sum(rows, 'totalTokens'), cached: sum(rows, 'cachedPromptTokens') }; }
const totals = computed(() => summary(visible.value));
const byProject = computed(() => projectOptions.value.map(([id, name]) => ({ id, name, ...summary(records.value.filter(record => record.projectId === id)) }))
  .filter(row => row.requests > 0));
const byDay = computed(() => {
  const days = new Map<string, AiUsageRecord[]>();
  for (const record of visible.value) {
    const local = new Date(record.createdAt);
    const day = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
    const rows = days.get(day) ?? [];
    rows.push(record);
    days.set(day, rows);
  }
  return [...days].map(([day, rows]) => ({ day, ...summary(rows) })).sort((a, b) => b.day.localeCompare(a.day));
});
const chartDays = computed(() => byDay.value.slice(0, 14).reverse());
const chartProjects = computed(() => byProject.value.filter(row => !selectedProject.value || row.id === selectedProject.value)
  .slice().sort((a, b) => b.total - a.total));
const maxDayTokens = computed(() => Math.max(1, ...chartDays.value.map(row => row.total)));
const maxProjectTokens = computed(() => Math.max(1, ...chartProjects.value.map(row => row.total)));
const cachedInput = computed(() => Math.min(totals.value.cached, totals.value.prompt));
const uncachedInput = computed(() => Math.max(0, totals.value.prompt - cachedInput.value));
const chartTotal = computed(() => cachedInput.value + uncachedInput.value + totals.value.completion);
const tokenMix = computed(() => {
  const cached = chartTotal.value ? cachedInput.value / chartTotal.value * 100 : 0;
  const input = chartTotal.value ? uncachedInput.value / chartTotal.value * 100 : 0;
  return chartTotal.value ? `conic-gradient(#8250df 0 ${cached}%, #0969da ${cached}% ${cached + input}%, #1a7f37 ${cached + input}% 100%)` : '#eaeef2';
});
function format(value: number | null) { return value === null ? '—' : number.format(value); }
function date(value: number) { return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(value); }
async function refresh() {
  busy.value = true; error.value = '';
  try { records.value = await listAiUsage(); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
  finally { busy.value = false; }
}
onMounted(() => { void refresh(); });
</script>

<template>
  <section class="ai-usage">
    <div class="ai-usage-heading"><div><h3>AI usage</h3><p>DeepSeek requests made by this browser for topic reviews. Token counts come from provider responses.</p></div><div class="ai-usage-controls"><label for="usage-project">Project</label><select id="usage-project" v-model="selectedProject"><option value="">All projects</option><option v-for="[id, name] in projectOptions" :key="id" :value="id">{{ name }}</option></select><button type="button" class="button-outline" :disabled="busy" @click="refresh">Refresh</button></div></div>
    <p v-if="error" class="inline-message error" role="alert">Could not load AI usage: {{ error }}</p>
    <div class="ai-usage-metrics"><div><span>Total tokens</span><strong>{{ format(totals.total) }}</strong></div><div><span>Input tokens</span><strong>{{ format(totals.prompt) }}</strong></div><div><span>Output tokens</span><strong>{{ format(totals.completion) }}</strong></div><div><span>API requests</span><strong>{{ format(totals.requests) }}</strong><small>{{ format(totals.errors) }} failed</small></div></div>
    <p class="ai-usage-note">Cached input: {{ format(totals.cached) }} tokens. Failed requests without provider usage are counted as requests; their token counts remain unknown.</p>
    <div v-if="!records.length && !busy && !error" class="ai-usage-empty">No AI requests recorded yet. Generate topics in a project to start tracking usage.</div>
    <div v-else-if="!visible.length && !busy && !error" class="ai-usage-empty">No AI requests recorded for this project.</div>
    <template v-if="visible.length">
      <div class="ai-usage-charts">
        <section class="ai-usage-panel ai-usage-chart-panel ai-usage-trend"><h4>Token usage over time <small>Last {{ chartDays.length }} recorded days</small></h4><div class="ai-usage-chart-body"><div class="ai-usage-chart-legend"><span><i class="ai-usage-key input"></i>Input</span><span><i class="ai-usage-key output"></i>Output</span></div><div class="ai-usage-day-chart" role="img" :aria-label="`Token usage by day: ${chartDays.map(row => `${row.day}: ${format(row.prompt)} input and ${format(row.completion)} output`).join('; ')}`"><div v-for="row in chartDays" :key="row.day" class="ai-usage-day-column" :title="`${row.day}: ${format(row.prompt)} input, ${format(row.completion)} output`"><div class="ai-usage-day-bar" :style="{ height: `${Math.max(2, row.total / maxDayTokens * 100)}%` }"><div class="ai-usage-bar-output" :style="{ height: `${row.total ? row.completion / row.total * 100 : 0}%` }"></div><div class="ai-usage-bar-input"></div></div><span>{{ row.day.slice(5) }}</span></div></div></div></section>
        <section class="ai-usage-panel ai-usage-chart-panel"><h4>Token breakdown</h4><div class="ai-usage-mix-body"><div class="ai-usage-donut" :style="{ background: tokenMix }" role="img" :aria-label="`${format(cachedInput)} cached input, ${format(uncachedInput)} other input, ${format(totals.completion)} output tokens`"><div><strong>{{ format(totals.total) }}</strong><small>tokens</small></div></div><div class="ai-usage-mix-legend"><div><span><i class="ai-usage-key cached"></i>Cached input</span><strong>{{ format(cachedInput) }}</strong></div><div><span><i class="ai-usage-key input"></i>Other input</span><strong>{{ format(uncachedInput) }}</strong></div><div><span><i class="ai-usage-key output"></i>Output</span><strong>{{ format(totals.completion) }}</strong></div></div></div></section>
        <section class="ai-usage-panel ai-usage-chart-panel"><h4>Usage by project</h4><div class="ai-usage-project-chart"><div v-for="row in chartProjects" :key="row.id" class="ai-usage-project-bar"><div><span :title="row.name">{{ row.name }}</span><strong>{{ format(row.total) }}</strong></div><div class="ai-usage-project-track" role="img" :aria-label="`${row.name}: ${format(row.total)} tokens`"><span :style="{ width: `${row.total / maxProjectTokens * 100}%` }"></span></div></div></div></section>
      </div>
      <section v-if="!selectedProject" class="ai-usage-panel"><h4>By project</h4><div class="ai-usage-table-wrap"><table><thead><tr><th>Project</th><th>Requests</th><th>Input</th><th>Output</th><th>Total tokens</th></tr></thead><tbody><tr v-for="row in byProject" :key="row.id"><td>{{ row.name }}</td><td>{{ format(row.requests) }}</td><td>{{ format(row.prompt) }}</td><td>{{ format(row.completion) }}</td><td>{{ format(row.total) }}</td></tr></tbody></table></div></section>
      <section class="ai-usage-panel"><h4>By day</h4><div class="ai-usage-table-wrap"><table><thead><tr><th>Day</th><th>Requests</th><th>Input</th><th>Output</th><th>Total tokens</th></tr></thead><tbody><tr v-for="row in byDay" :key="row.day"><td>{{ row.day }}</td><td>{{ format(row.requests) }}</td><td>{{ format(row.prompt) }}</td><td>{{ format(row.completion) }}</td><td>{{ format(row.total) }}</td></tr></tbody></table></div></section>
      <section class="ai-usage-panel"><h4>Request details</h4><div class="ai-usage-table-wrap"><table><thead><tr><th>Time</th><th>Project</th><th>Task</th><th>Model</th><th>Status</th><th>Input</th><th>Output</th><th>Cached input</th><th>Total</th></tr></thead><tbody><tr v-for="row in visible" :key="row.id"><td>{{ date(row.createdAt) }}</td><td>{{ projectNames.get(row.projectId) ?? row.projectName }}</td><td>Topic review · group {{ row.group }} · attempt {{ row.attempt }}</td><td>{{ row.model }}</td><td>{{ row.status === 'success' ? 'Completed' : row.httpStatus ? `HTTP ${row.httpStatus}` : 'Failed' }}</td><td>{{ format(row.promptTokens) }}</td><td>{{ format(row.completionTokens) }}</td><td>{{ format(row.cachedPromptTokens) }}</td><td>{{ format(row.totalTokens) }}</td></tr></tbody></table></div></section>
    </template>
  </section>
</template>
