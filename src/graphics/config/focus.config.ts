/** Niveaux de focus : ce que la carte nomme, et ce que le survol colorie. */
export const MAP_FOCUS = {
  communes: { label: "Communes" },
  departements: { label: "Departements" },
  regions: { label: "Regions" },
} as const;

export type MapFocusId = keyof typeof MAP_FOCUS;
