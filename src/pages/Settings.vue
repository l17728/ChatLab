<script setup lang="ts">
/**
 * Legacy Web UI settings shim — 此页已下线，设置面板只在桌面端暴露。
 * 路由 /webui-settings 已在 src/routes/index.ts 里被重定向到 /。
 */
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
onMounted(() => {
  router.replace('/')
})
</script>

<template>
  <div />
</template>
