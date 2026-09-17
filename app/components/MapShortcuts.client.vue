<script setup lang="ts">
import { MAP_VIEWS, type MapViewId } from '@graphics/config/views.config.ts'
import { isMapNavigator } from '@graphics/universes/MapNavigator.interface.ts'

const views = Object.entries(MAP_VIEWS) as [MapViewId, (typeof MAP_VIEWS)[MapViewId]][]

function go(id: MapViewId) {
  const universes = useThreeStage().read()?.runtime.output.getActiveUniverses() ?? []
  universes.find(isMapNavigator)?.flyTo(MAP_VIEWS[id])
}
</script>

<template>
  <nav class="shortcuts" aria-label="Aller a">
    <button v-for="[id, view] in views" :key="id" type="button" @click="go(id)">
      {{ view.label }}
    </button>
  </nav>
</template>

<style scoped>
.shortcuts {
  position: fixed;
  inset: auto 0 max(1.5rem, env(safe-area-inset-bottom)) 0;
  z-index: 3;
  display: flex;
  justify-content: center;
  gap: 0.5rem;
  pointer-events: none;
}

button {
  pointer-events: auto;
  padding: 0.55rem 1.1rem;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font: 500 0.875rem/1 var(--font-map);
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: background 160ms ease, border-color 160ms ease;
}

button:hover {
  border-color: rgba(255, 255, 255, 0.7);
}

button:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 2px;
}

button:active {
  background: rgba(255, 255, 255, 0.12);
}
</style>
