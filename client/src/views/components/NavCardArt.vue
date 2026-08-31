<template>
  <div class="nav-card-art">
    <svg
      class="nav-card-art-svg"
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient :id="gradId" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" :stop-color="pal.from" />
          <stop offset="100%" :stop-color="pal.to" />
        </linearGradient>
      </defs>

      <!-- 淡彩渐变底 -->
      <rect x="0" y="0" width="100" height="100" :fill="`url(#${gradId})`" />

      <!-- 形状变体：按 variant 切换装饰图案，营造多风格 -->
      <g :fill="pal.accent">
        <!-- variant 0：双圆点缀 -->
        <template v-if="variant === 0">
          <circle cx="82" cy="20" r="26" opacity="0.16" />
          <circle cx="18" cy="86" r="14" opacity="0.12" />
        </template>

        <!-- variant 1：底部波浪 -->
        <template v-else-if="variant === 1">
          <path
            d="M0 70 Q 25 55 50 70 T 100 70 V100 H0 Z"
            opacity="0.14"
          />
          <path
            d="M0 82 Q 25 70 50 82 T 100 82 V100 H0 Z"
            opacity="0.10"
          />
        </template>

        <!-- variant 2：散点网格 -->
        <template v-else-if="variant === 2">
          <g opacity="0.16">
            <circle
              v-for="(d, i) in dotGrid"
              :key="i"
              :cx="d.x"
              :cy="d.y"
              r="2.4"
            />
          </g>
        </template>

        <!-- variant 3：同心环 -->
        <template v-else-if="variant === 3">
          <circle cx="78" cy="78" r="34" fill="none" :stroke="pal.accent" stroke-width="3" opacity="0.12" />
          <circle cx="78" cy="78" r="22" fill="none" :stroke="pal.accent" stroke-width="3" opacity="0.16" />
          <circle cx="78" cy="78" r="10" opacity="0.18" />
        </template>

        <!-- variant 4：斜向色带 -->
        <template v-else-if="variant === 4">
          <path d="M-10 40 L 60 -10 L 80 -10 L 10 60 Z" opacity="0.12" />
          <path d="M20 110 L 110 30 L 110 50 L 40 110 Z" opacity="0.10" />
        </template>

        <!-- variant 5：重叠斑点 -->
        <template v-else>
          <ellipse cx="74" cy="28" rx="30" ry="22" opacity="0.14" />
          <ellipse cx="26" cy="74" rx="24" ry="18" opacity="0.10" />
        </template>
      </g>
    </svg>

    <!-- 图标叠加居中 -->
    <div class="nav-card-art-icon" :style="{ color: pal.accent }">
      <component :is="icon" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { PALETTES, type PaletteName } from '@/config/navArt'

const props = defineProps<{
  palette: PaletteName
  variant: number
  icon: string
}>()

const pal = computed(() => PALETTES[props.palette] || PALETTES.sky)

// 每个实例使用唯一的渐变 id，避免多 SVG 共用 id 冲突
const gradId = `navart-grad-${Math.random().toString(36).slice(2, 9)}`

// variant 2 的散点网格坐标
const dotGrid = computed(() => {
  const dots: { x: number; y: number }[] = []
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      dots.push({ x: 14 + c * 18, y: 14 + r * 18 })
    }
  }
  return dots
})
</script>

<style scoped>
.nav-card-art {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  overflow: hidden;
}

.nav-card-art-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}

.nav-card-art-icon {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nav-card-art-icon :deep(svg) {
  width: 44%;
  height: 44%;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.08));
}
</style>
