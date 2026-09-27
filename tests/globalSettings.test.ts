import { strict as assert } from 'node:assert';
import { defaultGlobalSettings, parseGlobalSettings, shouldShowDemoProject } from '../src/lib/globalSettings';
import { chatCompletionBody, copilotConnection, copilotIsConfigured } from '../src/lib/copilotProvider';

assert.deepEqual(parseGlobalSettings(null), defaultGlobalSettings);
assert.deepEqual(parseGlobalSettings('{"codeFontSize":15,"codeLineHeight":28}'), { ...defaultGlobalSettings, codeFontSize: 15, codeLineHeight: 28 });
assert.deepEqual(parseGlobalSettings('{"codeFontSize":100,"codeLineHeight":12}'), defaultGlobalSettings);
assert.deepEqual(parseGlobalSettings('{"showLineNumbers":false,"defaultReviewTab":"commits","copilotProvider":"custom","copilotRole":"security"}'), {
  ...defaultGlobalSettings, showLineNumbers: false, defaultReviewTab: 'commits',
});
assert.deepEqual(parseGlobalSettings('{"showReadmePreview":"false","defaultReviewTab":"unknown","copilotModel":42}'), defaultGlobalSettings);
assert.deepEqual(parseGlobalSettings('{"copilotProvider":"deepseek","copilotDeepSeekApiKey":"test-key","copilotModel":"deepseek-v4-pro","copilotInstructions":"old"}'), {
  ...defaultGlobalSettings, copilotDeepSeekApiKey: 'test-key', copilotModel: 'deepseek-v4-pro',
});
assert.deepEqual(parseGlobalSettings('invalid'), defaultGlobalSettings);
assert.deepEqual(parseGlobalSettings('{"language":"zh-CN","copilotSummaryLanguage":"zh-CN","copilotReviewLanguage":"zh-CN"}'), {
  ...defaultGlobalSettings, language: 'zh-CN', copilotSummaryLanguage: 'zh-CN', copilotReviewLanguage: 'zh-CN',
});
assert.deepEqual(parseGlobalSettings('{"language":"invalid","copilotSummaryLanguage":"invalid","copilotReviewLanguage":"invalid"}'), defaultGlobalSettings);
assert.equal(parseGlobalSettings('{"fileChangeDetection":"timer"}').fileChangeDetection, 'timer');
assert.equal(parseGlobalSettings('{"fileChangeDetection":"invalid"}').fileChangeDetection, 'observer');
assert.equal(parseGlobalSettings('{"githubPersonalAccessToken":"github-token"}').githubPersonalAccessToken, 'github-token');
assert.equal(defaultGlobalSettings.copilotReviewConcurrency, 4);
assert.equal(parseGlobalSettings('{"copilotReviewConcurrency":6}').copilotReviewConcurrency, 6);
assert.equal(parseGlobalSettings('{"copilotReviewConcurrency":99}').copilotReviewConcurrency, 4);
assert.equal(defaultGlobalSettings.autoGenerateTopicsOnCreate, false);
assert.equal(parseGlobalSettings('{"autoGenerateTopicsOnCreate":true}').autoGenerateTopicsOnCreate, true);
assert.equal(parseGlobalSettings('{"autoGenerateTopicsOnCreate":"true"}').autoGenerateTopicsOnCreate, false);
const openAi = parseGlobalSettings('{"copilotProvider":"openai","copilotOpenAiApiKey":" openai-key ","copilotOpenAiModel":"gpt-4.1-mini"}');
assert.equal(copilotIsConfigured(openAi), true);
assert.deepEqual(copilotConnection(openAi), { provider: 'openai', model: 'gpt-4.1-mini', apiKey: 'openai-key', endpoint: 'https://api.openai.com/v1/chat/completions' });
assert.equal(copilotIsConfigured({ ...openAi, copilotOpenAiModel: 'bad model' }), false);
assert.equal(copilotIsConfigured({ ...openAi, copilotOpenAiApiKey: '' }), false);
assert.equal(copilotConnection({ ...openAi, copilotProvider: 'deepseek' }).endpoint, 'https://api.deepseek.com/chat/completions');
assert.deepEqual(chatCompletionBody('openai', { model: 'gpt-4.1', max_tokens: 4000 }), { model: 'gpt-4.1', max_completion_tokens: 4000 });
assert.deepEqual(chatCompletionBody('deepseek', { model: 'deepseek-flash', max_tokens: 4000 }), { model: 'deepseek-flash', max_tokens: 4000 });
assert.equal(shouldShowDemoProject(defaultGlobalSettings, 0, false), true);
assert.equal(shouldShowDemoProject({ ...defaultGlobalSettings, showDemoProject: false }, 0, false), false);
assert.equal(shouldShowDemoProject(defaultGlobalSettings, 1, false), false);
assert.equal(shouldShowDemoProject(defaultGlobalSettings, 0, true), false);
console.log('Global settings test passed');
