import { strict as assert } from 'node:assert';
import { defaultGlobalSettings, parseGlobalSettings } from '../src/lib/globalSettings';

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
console.log('Global settings test passed');
