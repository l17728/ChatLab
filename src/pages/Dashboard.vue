<script setup lang="ts">
/**
 * Legacy dashboard shim — 此页已下线，保留文件仅为避免动态 import 报错。
 * 路由 /dashboard 已在 src/routes/index.ts 里被重定向到 /。
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
