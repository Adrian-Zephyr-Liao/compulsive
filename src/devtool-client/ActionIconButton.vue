<script setup lang="ts">
import { vTooltip } from "floating-vue";

defineProps<{ tooltip: string; icon: string; disabled?: boolean }>();
</script>

<template>
  <button
    v-tooltip="{ content: tooltip, placement: 'top', delay: { show: 180, hide: 0 } }"
    class="icon-button"
    type="button"
    :disabled="disabled"
    :aria-label="tooltip"
  >
    <span :class="icon" aria-hidden="true" />
  </button>
</template>
