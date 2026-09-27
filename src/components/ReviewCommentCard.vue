<script setup lang="ts">
import type { ReviewComment } from '../lib/aiReviewTypes';
import { language, t } from '../lib/i18n';

defineProps<{ comment: ReviewComment; createdAt?: number; lineText?: string; showAnchor?: boolean }>();
</script>
<template>
  <div class="diff-review-comment">
    <header><span class="diff-review-avatar"><i class="bi bi-robot" aria-hidden="true"></i></span><strong>Ming AI</strong><span>{{ t('commented') }}</span><span v-if="comment.severity" class="review-severity" :class="`is-${comment.severity}`">{{ t(({ high: 'High', medium: 'Medium', low: 'Low' })[comment.severity]) }}</span><time v-if="createdAt" :datetime="new Date(createdAt).toISOString()">{{ new Date(createdAt).toLocaleString(language) }}</time></header>
    <div class="diff-review-comment-body"><div v-if="showAnchor" class="diff-review-anchor"><code>{{ comment.side === 'LEFT' ? '−' : '+' }}{{ comment.lineNumber }}</code><code v-if="lineText">{{ lineText }}</code></div><p>{{ comment.body }}</p><div v-if="comment.suggestion" class="diff-review-suggestion"><strong>{{ t('Suggested change') }}</strong><pre><code>{{ comment.suggestion }}</code></pre></div></div>
  </div>
</template>
