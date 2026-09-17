<script setup lang="ts">
/**
 * Le hero est rendu par le serveur et constitue le LCP : il est peint avant
 * que le moteur ne soit meme telecharge. Il s'efface des que la premiere image
 * 3D est prete, plutot que de laisser un ecran noir pendant le chargement.
 */
const started = ref(false)
</script>

<template>
  <main class="shell">
    <ThreeStage @ready="started = true" />
    <MapShortcuts v-if="started" />

    <section class="hero" :class="{ 'is-hidden': started }">
      <h1>Carte de France</h1>
      <p>Initialisation de la scene temps reel</p>
    </section>
  </main>
</template>

<style scoped>
.shell {
  position: fixed;
  inset: 0;
}

.hero {
  position: fixed;
  inset: auto auto 1rem 1rem;
  z-index: 2;
  pointer-events: none;
  max-width: min(90vw, 28rem);
  padding: 0.75rem 0.9rem;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 0.5rem;
  background: rgba(0, 0, 0, 0.45);
  transition: opacity 320ms ease, transform 320ms ease;
}

.hero.is-hidden {
  opacity: 0;
  transform: translateY(8px);
}

@media (prefers-reduced-motion: reduce) {
  .hero { transition: none; }
}

.hero h1 {
  margin: 0;
  font-size: clamp(1rem, 1.8vw, 1.25rem);
  line-height: 1.2;
  font-weight: 600;
}

.hero p {
  margin: 0.35rem 0 0;
  font-size: clamp(0.8rem, 1.2vw, 0.95rem);
  line-height: 1.3;
  color: rgba(255, 255, 255, 0.85);
}
</style>
