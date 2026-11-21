-- Organizaciones que la coordinación agrega, renombra o quita desde el panel.
-- Las fichas del sitio estático (fichas.json) siguen siendo la base; esta tabla guarda solo los cambios.
CREATE TABLE organizaciones (
  slug TEXT PRIMARY KEY,
  nombre TEXT,                         -- NULL = el nombre del sitio
  comuna TEXT,                         -- NULL = la comuna del sitio
  nueva INTEGER NOT NULL DEFAULT 0,    -- 1 = creada en el panel (no tiene página estática)
  oculta INTEGER NOT NULL DEFAULT 0,   -- 1 = quitada de la página (se puede volver a mostrar)
  creada INTEGER NOT NULL,
  actualizada INTEGER NOT NULL
);
