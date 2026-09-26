<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { ChartConfiguration } from 'chart.js';
import UsageChart from './UsageChart.vue';
import { listAiUsage, type AiUsageRecord, type Project } from '../lib/projectStore';
import { language, t } from '../lib/i18n';
import { hourlyUsage } from '../lib/usageTrends';

const props = defineProps<{ projects: Project[] }>();
const records = ref<AiUsageRecord[]>([]);
const selectedProject = ref('');
const busy = ref(false);
const error = ref('');
const chartNow = ref(Date.now());
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
const chartHours = computed(() => hourlyUsage(visible.value, chartNow.value));
const chartProjects = computed(() => byProject.value.filter(row => !selectedProject.value || row.id === selectedProject.value)
  .slice().sort((a, b) => b.total - a.total));
const chartColors = { input: '#0969da', output: '#1a7f37', cached: '#fd8c73', muted: '#59636e', grid: '#eaeef2' };
const cachedInput = computed(() => Math.min(totals.value.cached, totals.value.prompt));
const uncachedInput = computed(() => Math.max(0, totals.value.prompt - cachedInput.value));
const chartTotal = computed(() => cachedInput.value + uncachedInput.value + totals.value.completion);
const trendConfig = computed<ChartConfiguration>(() => ({
  type: 'bar',
  data: {
    labels: chartHours.value.map(row => hourLabel(row.start)),
    datasets: [
      { label: t('Input'), data: chartHours.value.map(row => row.prompt), backgroundColor: chartColors.input, stack: 'tokens' },
      { label: t('Output'), data: chartHours.value.map(row => row.completion), backgroundColor: chartColors.output, stack: 'tokens' },
    ],
  },
  options: { responsive: true, maintainAspectRatio: false, color: chartColors.muted,
    plugins: { legend: { position: 'top', labels: { color: chartColors.muted } } },
    scales: { x: { stacked: true, ticks: { maxTicksLimit: 7, color: chartColors.muted }, grid: { color: chartColors.grid } },
      y: { stacked: true, beginAtZero: true, ticks: { color: chartColors.muted }, grid: { color: chartColors.grid } } } },
}));
const mixConfig = computed<ChartConfiguration>(() => ({
  type: 'doughnut',
  data: { labels: [t('Cached input'), t('Other input'), t('Output')], datasets: [{
    data: [cachedInput.value, uncachedInput.value, totals.value.completion],
    backgroundColor: [chartColors.cached, chartColors.input, chartColors.output], borderWidth: 0,
  }] },
  options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { display: false } } },
}));
const projectConfig = computed<ChartConfiguration>(() => ({
  type: 'bar',
  data: { labels: chartProjects.value.map(row => row.name), datasets: [{
    label: t('Total tokens'), data: chartProjects.value.map(row => row.total), backgroundColor: chartColors.input,
  }] },
  options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, color: chartColors.muted,
    plugins: { legend: { display: false } },
    scales: { x: { beginAtZero: true, ticks: { color: chartColors.muted }, grid: { color: chartColors.grid } },
      y: { ticks: { color: chartColors.muted }, grid: { display: false } } } },
}));
function format(value: number | null) { return value === null ? '—' : number.format(value); }
function date(value: number) { return new Intl.DateTimeFormat(language.value, { dateStyle: 'medium', timeStyle: 'short' }).format(value); }
function hourLabel(value: number) { return new Intl.DateTimeFormat(language.value, { month: 'numeric', day: 'numeric', hour: '2-digit', hour12: false }).format(value); }
async function refresh() {
  busy.value = true; error.value = '';
  try { records.value = await listAiUsage(); chartNow.value = Date.now(); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
  finally { busy.value = false; }
}
onMounted(() => { void refresh(); });
</script>

<template>
  <section class="ai-usage">
    <div class="ai-usage-heading"><div><h3>{{ t('AI usage') }}</h3><p>{{ t('DeepSeek requests made by this browser for review titles and topics. Token counts come from provider responses.') }}</p></div><div class="ai-usage-controls"><label for="usage-project">{{ t('Project') }}</label><select id="usage-project" v-model="selectedProject"><option value="">{{ t('All projects') }}</option><option v-for="[id, name] in projectOptions" :key="id" :value="id">{{ name }}</option></select><button type="button" class="button-outline" :disabled="busy" @click="refresh">{{ t('Refresh') }}</button></div></div>
    <p v-if="error" class="inline-message error" role="alert">{{ language === 'zh-CN' ? '无法加载 AI 用量：' : 'Could not load AI usage: ' }}{{ error }}</p>
    <div class="ai-usage-metrics"><div><span>{{ t('Total tokens') }}</span><strong>{{ format(totals.total) }}</strong></div><div><span>{{ t('Input tokens') }}</span><strong>{{ format(totals.prompt) }}</strong></div><div><span>{{ t('Output tokens') }}</span><strong>{{ format(totals.completion) }}</strong></div><div><span>{{ t('API requests') }}</span><strong>{{ format(totals.requests) }}</strong><small>{{ format(totals.errors) }} {{ language === 'zh-CN' ? '次失败' : 'failed' }}</small></div></div>
    <p class="ai-usage-note">{{ language === 'zh-CN' ? `缓存输入：${format(totals.cached)} Token。未返回用量的失败请求会计入请求数，其 Token 数量未知。` : `Cached input: ${format(totals.cached)} tokens. Failed requests without provider usage are counted as requests; their token counts remain unknown.` }}</p>
    <div v-if="!records.length && !busy && !error" class="ai-usage-empty">{{ t('No AI requests recorded yet. Scan changes or generate topics to start tracking usage.') }}</div>
    <div v-else-if="!visible.length && !busy && !error" class="ai-usage-empty">{{ t('No AI requests recorded for this project.') }}</div>
    <template v-if="visible.length">
      <div class="ai-usage-charts">
        <section class="ai-usage-panel ai-usage-chart-panel ai-usage-trend"><h4>{{ t('Token usage over time') }} <small>{{ t('Last 24 hours · local time') }}</small></h4><div class="ai-usage-chart-body"><div class="ai-usage-chart-canvas"><UsageChart :config="trendConfig" :label="`${t('Hourly token usage')}: ${chartHours.map(row => `${hourLabel(row.start)}: ${format(row.prompt)} ${t('Input')}, ${format(row.completion)} ${t('Output')}`).join('; ')}`" /></div></div></section>
        <section class="ai-usage-panel ai-usage-chart-panel"><h4>{{ t('Token breakdown') }}</h4><div class="ai-usage-mix-body"><div class="ai-usage-mix-canvas"><UsageChart :config="mixConfig" :label="`${format(cachedInput)} ${t('Cached input')}, ${format(uncachedInput)} ${t('Other input')}, ${format(totals.completion)} ${t('Output')}`" /></div><div class="ai-usage-mix-legend"><div><span><i class="ai-usage-key cached"></i>{{ t('Cached input') }}</span><strong>{{ format(cachedInput) }}</strong></div><div><span><i class="ai-usage-key input"></i>{{ t('Other input') }}</span><strong>{{ format(uncachedInput) }}</strong></div><div><span><i class="ai-usage-key output"></i>{{ t('Output') }}</span><strong>{{ format(totals.completion) }}</strong></div></div></div></section>
        <section class="ai-usage-panel ai-usage-chart-panel"><h4>{{ t('Usage by project') }}</h4><div class="ai-usage-project-chart"><div class="ai-usage-project-canvas" :style="{ height: `${Math.max(180, chartProjects.length * 36)}px` }"><UsageChart :config="projectConfig" :label="`${t('Usage by project')}: ${chartProjects.map(row => `${row.name}: ${format(row.total)}`).join('; ')}`" /></div></div></section>
      </div>
      <section v-if="!selectedProject" class="ai-usage-panel"><h4>{{ t('By project') }}</h4><div class="ai-usage-table-wrap"><table><thead><tr><th>{{ t('Project') }}</th><th>{{ t('Requests') }}</th><th>{{ t('Input') }}</th><th>{{ t('Output') }}</th><th>{{ t('Total tokens') }}</th></tr></thead><tbody><tr v-for="row in byProject" :key="row.id"><td>{{ row.name }}</td><td>{{ format(row.requests) }}</td><td>{{ format(row.prompt) }}</td><td>{{ format(row.completion) }}</td><td>{{ format(row.total) }}</td></tr></tbody></table></div></section>
      <section class="ai-usage-panel"><h4>{{ t('By day') }}</h4><div class="ai-usage-table-wrap"><table><thead><tr><th>{{ t('Day') }}</th><th>{{ t('Requests') }}</th><th>{{ t('Input') }}</th><th>{{ t('Output') }}</th><th>{{ t('Total tokens') }}</th></tr></thead><tbody><tr v-for="row in byDay" :key="row.day"><td>{{ row.day }}</td><td>{{ format(row.requests) }}</td><td>{{ format(row.prompt) }}</td><td>{{ format(row.completion) }}</td><td>{{ format(row.total) }}</td></tr></tbody></table></div></section>
      <section class="ai-usage-panel"><h4>{{ t('Request details') }}</h4><div class="ai-usage-table-wrap"><table><thead><tr><th>{{ t('Time') }}</th><th>{{ t('Project') }}</th><th>{{ t('Task') }}</th><th>{{ t('Model') }}</th><th>{{ t('Status') }}</th><th>{{ t('Input') }}</th><th>{{ t('Output') }}</th><th>{{ t('Cached input') }}</th><th>{{ t('Total') }}</th></tr></thead><tbody><tr v-for="row in visible" :key="row.id"><td>{{ date(row.createdAt) }}</td><td>{{ projectNames.get(row.projectId) ?? row.projectName }}</td><td>{{ row.task === 'review-title' ? t('Review title') : language === 'zh-CN' ? `主题评审 · 第 ${row.group} 组 · 第 ${row.attempt} 次尝试` : `Topic review · group ${row.group} · attempt ${row.attempt}` }}</td><td>{{ row.model }}</td><td>{{ t(row.status === 'success' ? 'Completed' : row.httpStatus ? `HTTP ${row.httpStatus}` : 'Failed') }}</td><td>{{ format(row.promptTokens) }}</td><td>{{ format(row.completionTokens) }}</td><td>{{ format(row.cachedPromptTokens) }}</td><td>{{ format(row.totalTokens) }}</td></tr></tbody></table></div></section>
    </template>
  </section>
</template>
