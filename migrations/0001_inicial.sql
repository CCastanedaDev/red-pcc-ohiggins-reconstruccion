-- Panel de edición de la Red PCC O'Higgins

CREATE TABLE usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nombre TEXT NOT NULL DEFAULT '',
  rol TEXT NOT NULL CHECK (rol IN ('org', 'admin')),
  org TEXT,                       -- slug de la ficha (solo rol org)
  hash TEXT NOT NULL,
  sal TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1,
  debe_cambiar INTEGER NOT NULL DEFAULT 1,
  creado INTEGER NOT NULL
);

CREATE TABLE sesiones (
  token_hash TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  expira INTEGER NOT NULL
);

CREATE TABLE intentos (
  usuario TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX intentos_usuario ON intentos(usuario, ts);

CREATE TABLE cambios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org TEXT NOT NULL,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  datos TEXT NOT NULL,            -- JSON con reseña, redes, logo, portada, galería
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aprobado', 'rechazado', 'reemplazado')),
  comentario TEXT NOT NULL DEFAULT '',
  creado INTEGER NOT NULL,
  revisado INTEGER,
  revisor_id INTEGER REFERENCES usuarios(id)
);
CREATE INDEX cambios_org ON cambios(org, estado);

CREATE TABLE publicadas (
  org TEXT PRIMARY KEY,
  datos TEXT NOT NULL,
  cambio_id INTEGER NOT NULL REFERENCES cambios(id),
  actualizado INTEGER NOT NULL
);

CREATE TABLE fotos (
  id TEXT PRIMARY KEY,
  org TEXT NOT NULL,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  tipo TEXT NOT NULL,
  ancho INTEGER NOT NULL,
  alto INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  datos BLOB NOT NULL,
  creado INTEGER NOT NULL
);
CREATE INDEX fotos_org ON fotos(org);
