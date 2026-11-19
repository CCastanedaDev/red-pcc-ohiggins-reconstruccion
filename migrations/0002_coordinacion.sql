-- Tres niveles de cuenta, puntos de confianza e historial de actividad

-- super = 1: soporte técnico. Nadie desde el panel puede desactivarla ni cambiarle la contraseña.
ALTER TABLE usuarios ADD COLUMN super INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usuarios ADD COLUMN ultimo_ingreso INTEGER;
UPDATE usuarios SET super = 1 WHERE usuario = 'red';

-- Puntos que publican sin pasar por revisión
CREATE TABLE confianza (
  org TEXT PRIMARY KEY,
  desde INTEGER NOT NULL,
  usuario_id INTEGER REFERENCES usuarios(id)
);

-- Quién hizo qué y cuándo
CREATE TABLE registro (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  usuario_id INTEGER REFERENCES usuarios(id),
  org TEXT,
  accion TEXT NOT NULL,
  detalle TEXT NOT NULL DEFAULT ''
);
CREATE INDEX registro_org ON registro(org, ts);
CREATE INDEX registro_ts ON registro(ts);
