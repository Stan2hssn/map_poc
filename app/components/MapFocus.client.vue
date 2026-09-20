<script setup lang="ts">
/** Onglets de focus : ce que la carte nomme, et ce que le survol colorie en rouge. */
import { MAP_FOCUS, type MapFocusId } from '@graphics/config/focus.config.ts'
import { isMapNavigator } from '@graphics/universes/MapNavigator.interface.ts'

const levels = Object.entries(MAP_FOCUS) as [MapFocusId, (typeof MAP_FOCUS)[MapFocusId]][]
const active = ref<MapFocusId>('communes')

function select(id: MapFocusId) {
  if (id === active.value) return
  active.value = id
  const universes = useThreeStage().read()?.runtime.output.getActiveUniverses() ?? []
  universes.find(isMapNavigator)?.setFocus(id)
}
</script>

<template>
  <nav class="focus" aria-label="Niveau">
    <button
      v-for="[id, level] in levels"
      :key="id"
      type="button"
      :aria-pressed="id === active"
      :class="{ 'is-active': id === active }"
      @click="select(id)"
    >
      {{ level.label }}
    </button>
  </nav>
</template>

<style scoped>
.focus {
  position: fixed;
  inset: max(1.5rem, env(safe-area-inset-top)) 0 auto 0;
  z-index: 3;
  display: flex;
  justify-content: center;
  gap: 0.25rem;
  pointer-events: none;
}

button {
  pointer-events: auto;
  padding: 0.45rem 0.95rem;
  border: 1px solid rgb(29 42 77 / 0.25);
  border-radius: 999px;
  background: rgb(241 236 224 / 0.75);
  color: rgb(29 42 77 / 0.75);
  font: 500 0.8rem/1 var(--font-map);
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: background 160ms ease, border-color 160ms ease, color 160ms ease;
}

button:hover {
  border-color: rgb(29 42 77 / 0.55);
}

button.is-active {
  border-color: #c0392b;
  color: #c0392b;
}

button:focus-visible {
  outline: 2px solid rgb(29 42 77 / 0.6);
  outline-offset: 2px;
}
</style>
