<template>
  <SalesCustomReport :key="reportKind" :report-type="reportKind" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import SalesCustomReport from './SalesCustomReport.vue'

const route = useRoute()
const reportKind = computed<'sales' | 'purchase'>(() => route.query.kind === 'purchase' ? 'purchase' : 'sales')
</script>
