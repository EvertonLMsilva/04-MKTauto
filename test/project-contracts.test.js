import test from "node:test";
import assert from "node:assert/strict";
import {
  PROJECT_CONTRACT_VERSION,
  PROJECT_DEFAULTS,
  PROJECT_SCHEMAS,
  createProjectSnapshot,
  validateChannelProfile,
  validateProject,
  validateProjectSnapshot,
  validateReferenceProfile,
} from "../backend/dist/project/domain/project-contracts.js";
import { ContractValidationError } from "../backend/dist/project/domain/project.errors.js";

function validProject(overrides = {}) {
  return {
    id: "project_curiosidades_ia",
    name: "  Curiosidades   IA  ",
    niche: " Inteligência Artificial ",
    subniches: [" Ferramentas ", "Produtividade"],
    audience: {
      profile: " Pessoas interessadas em tecnologia ",
      language: "pt-br",
    },
    references: [{
      platform: "INSTAGRAM",
      handle: " @PerfilA ",
      purpose: "strategic_reference",
    }],
    channel: {
      publishing: {
        contentsPerDay: 2,
        networks: ["INSTAGRAM", "threads"],
        timezone: "America/Sao_Paulo",
        times: ["18:00", "10:00"],
      },
    },
    ...overrides,
  };
}

test("produz ProjectSnapshot normalizado, versionado e profundamente imutável", () => {
  const snapshot = createProjectSnapshot(validProject());

  assert.equal(snapshot.schemaVersion, PROJECT_CONTRACT_VERSION);
  assert.deepEqual(snapshot.project, {
    id: "project_curiosidades_ia",
    name: "Curiosidades IA",
    version: 1,
    niche: "inteligência artificial",
    subniches: ["ferramentas", "produtividade"],
    audience: {
      profile: "Pessoas interessadas em tecnologia",
      language: "pt-BR",
    },
  });
  assert.deepEqual(snapshot.channel.publishing, {
    contentsPerDay: 2,
    networks: ["instagram", "threads"],
    timezone: "America/Sao_Paulo",
    times: ["10:00", "18:00"],
  });
  assert.equal(snapshot.references[0].handle, "@PerfilA");
  assert.equal(snapshot.references[0].grantsUsageRights, false);
  assert.equal(snapshot.references[0].usage, "strategic_reference_only");
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.project.audience), true);
  assert.equal(Object.isFrozen(snapshot.channel.publishing.times), true);
  assert.throws(() => snapshot.project.name = "alterado", TypeError);
});

test("revalida o envelope normalizado de ProjectSnapshot", () => {
  const snapshot = createProjectSnapshot(validProject());
  assert.deepEqual(validateProjectSnapshot(JSON.parse(JSON.stringify(snapshot))), snapshot);

  const altered = JSON.parse(JSON.stringify(snapshot));
  altered.references[0].grantsUsageRights = true;
  assert.throws(
    () => validateProjectSnapshot(altered),
    (error) => error.code === "INVALID_REFERENCE_RIGHTS" && error.path === "references[0]",
  );
});

test("aplica defaults determinísticos documentados", () => {
  const input = validProject({
    audience: { profile: "Público geral" },
    subniches: undefined,
    references: undefined,
    channel: { publishing: { networks: ["instagram"] } },
  });

  const first = createProjectSnapshot(input);
  const second = createProjectSnapshot(input);
  assert.deepEqual(first, second);
  assert.deepEqual(first.project.subniches, []);
  assert.deepEqual(first.references, []);
  assert.equal(first.project.audience.language, PROJECT_DEFAULTS.language);
  assert.deepEqual(first.channel, {
    format: "short_video",
    aspectRatio: "9:16",
    minDurationSeconds: 25,
    maxDurationSeconds: 45,
    minVideoAssetDurationSeconds: 25,
    maxVideoAssetDurationSeconds: 45,
    editorialStyle: "informative",
    visualStyle: "dynamic",
    voiceStyle: "informative",
    productionProfile: "STATIC_IMAGE_V1",
    publishing: {
      contentsPerDay: 1,
      networks: ["instagram"],
      timezone: "America/Sao_Paulo",
      times: ["10:00"],
    },
  });
});

test("mantém imagens estáticas por padrão e aceita mídia mista explicitamente", () => {
  assert.equal(createProjectSnapshot(validProject()).channel.productionProfile, "STATIC_IMAGE_V1");
  assert.equal(createProjectSnapshot(validProject({
    channel: { ...validProject().channel, productionProfile: "mixed_media_v2" },
  })).channel.productionProfile, "MIXED_MEDIA_V2");
  assert.throws(() => createProjectSnapshot(validProject({
    channel: { ...validProject().channel, productionProfile: "LATEST" },
  })), (error) => error.code === "INVALID_PRODUCTION_PROFILE" && error.path === "channel.productionProfile");
});

test("separa duração de assets de vídeo da duração final no MIXED_MEDIA_V2", () => {
  const snapshot = createProjectSnapshot(validProject({
    channel: {
      ...validProject().channel,
      productionProfile: "MIXED_MEDIA_V2",
      minDurationSeconds: 25,
      maxDurationSeconds: 45,
      minVideoAssetDurationSeconds: 5,
      maxVideoAssetDurationSeconds: 45,
    },
  }));

  assert.equal(snapshot.channel.minDurationSeconds, 25);
  assert.equal(snapshot.channel.maxDurationSeconds, 45);
  assert.equal(snapshot.channel.minVideoAssetDurationSeconds, 5);
  assert.equal(snapshot.channel.maxVideoAssetDurationSeconds, 45);
});

test("define schemas separados para Project, ChannelProfile, ReferenceProfile e ProjectSnapshot", () => {
  assert.deepEqual(Object.keys(PROJECT_SCHEMAS), [
    "Project",
    "ChannelProfile",
    "ReferenceProfile",
    "ProjectSnapshot",
  ]);
  for (const schema of Object.values(PROJECT_SCHEMAS)) {
    assert.equal(schema.schemaVersion, PROJECT_CONTRACT_VERSION);
    assert.equal(schema.additionalProperties, false);
    assert.equal(Object.isFrozen(schema), true);
  }
});

test("validadores de entidade retornam somente dados normalizados", () => {
  const project = validateProject(validProject());
  const channel = validateChannelProfile(validProject().channel);
  const reference = validateReferenceProfile(validProject().references[0], "references[0]");

  assert.equal(project.name, "Curiosidades IA");
  assert.equal("channel" in project, false);
  assert.equal("references" in project, false);
  assert.equal(channel.aspectRatio, "9:16");
  assert.deepEqual(reference, {
    platform: "instagram",
    handle: "@PerfilA",
    purpose: "strategic_reference",
    usage: "strategic_reference_only",
    grantsUsageRights: false,
  });
});

test("rejeita duração invertida, frequência e agenda inconsistentes com código e campo estáveis", () => {
  const cases = [
    [
      validProject({ channel: { minDurationSeconds: 60, maxDurationSeconds: 30, publishing: validProject().channel.publishing } }),
      "INVALID_DURATION_RANGE",
      "channel.maxDurationSeconds",
    ],
    [
      validProject({ channel: { publishing: { ...validProject().channel.publishing, contentsPerDay: 0 } } }),
      "INVALID_FREQUENCY",
      "channel.publishing.contentsPerDay",
    ],
    [
      validProject({ channel: { publishing: { ...validProject().channel.publishing, times: ["10:00"] } } }),
      "SCHEDULE_FREQUENCY_MISMATCH",
      "channel.publishing.times",
    ],
    [
      validProject({ channel: { publishing: { ...validProject().channel.publishing, times: ["10:00", "10:00"] } } }),
      "DUPLICATE_VALUE",
      "channel.publishing.times[1]",
    ],
  ];

  for (const [input, code, path] of cases) {
    assert.throws(
      () => createProjectSnapshot(input),
      (error) => error instanceof ContractValidationError && error.code === code && error.path === path,
    );
  }
});

test("rejeita redes, timezone, horário, idioma, formato e proporção inválidos", () => {
  const cases = [
    [validProject({ channel: { publishing: { ...validProject().channel.publishing, networks: [] } } }), "REQUIRED_FIELD", "channel.publishing.networks"],
    [validProject({ channel: { publishing: { ...validProject().channel.publishing, networks: ["orkut", "threads"] } } }), "INVALID_NETWORK", "channel.publishing.networks[0]"],
    [validProject({ channel: { publishing: { ...validProject().channel.publishing, timezone: "Brasil/SP" } } }), "INVALID_TIMEZONE", "channel.publishing.timezone"],
    [validProject({ channel: { publishing: { ...validProject().channel.publishing, times: ["10:00", "24:00"] } } }), "INVALID_TIME", "channel.publishing.times[1]"],
    [validProject({ audience: { profile: "Público", language: "português" } }), "INVALID_LANGUAGE", "project.audience.language"],
    [validProject({ channel: { format: "story", publishing: validProject().channel.publishing } }), "INVALID_FORMAT", "channel.format"],
    [validProject({ channel: { aspectRatio: "3:2", publishing: validProject().channel.publishing } }), "INVALID_ASPECT_RATIO", "channel.aspectRatio"],
  ];

  for (const [input, code, path] of cases) {
    assert.throws(
      () => createProjectSnapshot(input),
      (error) => error.code === code && error.path === path,
    );
  }
});

test("rejeita identificação, listas duplicadas, referências não estratégicas e schema incompatível", () => {
  const cases = [
    [validProject({ id: "ID inválido" }), "INVALID_ID", "project.id"],
    [validProject({ name: " " }), "REQUIRED_FIELD", "project.name"],
    [validProject({ subniches: ["IA", " ia "] }), "DUPLICATE_VALUE", "project.subniches[1]"],
    [validProject({ references: [{ platform: "instagram", handle: "@x", purpose: "content_reuse" }] }), "INVALID_REFERENCE_PURPOSE", "references[0].purpose"],
    [validProject({ schemaVersion: "project-contracts/9.0.0" }), "UNSUPPORTED_SCHEMA_VERSION", "schemaVersion"],
  ];

  for (const [input, code, path] of cases) {
    assert.throws(() => createProjectSnapshot(input), (error) => error.code === code && error.path === path);
  }
});

test("rejeita credenciais, tokens e segredos em qualquer profundidade", () => {
  const cases = [
    validProject({ token: "abc" }),
    validProject({ channel: { ...validProject().channel, apiKey: "abc" } }),
    validProject({ references: [{ platform: "instagram", handle: "@x", purpose: "strategic_reference", credentials: { user: "x" } }] }),
  ];

  for (const input of cases) {
    assert.throws(
      () => createProjectSnapshot(input),
      (error) => error.code === "SENSITIVE_FIELD_REJECTED" && error.path.length > 0,
    );
  }
});

test("rejeita campos desconhecidos sem refletir payload não sanitizado", () => {
  assert.throws(
    () => createProjectSnapshot(validProject({ internalNotes: "não publicar" })),
    (error) => error.code === "UNKNOWN_FIELD" && error.path === "project.internalNotes" && !error.message.includes("não publicar"),
  );
});
