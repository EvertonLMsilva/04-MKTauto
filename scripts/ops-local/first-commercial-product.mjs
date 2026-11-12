import { open, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const requiredFields = Object.freeze([
  'dataOrigin',
  'project (project-contracts/1.0.0 snapshot)',
  'product.productId',
  'product.revision',
  'product.name',
  'product.brand',
  'product.attributes[].name/value/evidenceRef',
  'product.evidence[]',
  'product.media[].mediaRef/evidenceRef',
  'product.localImage.mediaReference',
  'product.localImage.contentHash',
  'product.localImage.origin/provider/rights',
  'campaign.campaignId',
  'campaign.revision',
  'campaign.projectId',
  'campaign.productId',
  'campaign.productRevision',
  'campaign.affiliateUrl',
  'campaign.cta',
  'campaign.disclosure',
]);
const endpoints = Object.freeze({
  project: 'GET /projects/:projectId/versions/:version',
  registerProduct: 'POST /affiliate/products',
  product: 'GET /affiliate/products/:productId/revisions/:revision',
  registerCampaign: 'POST /affiliate/campaigns',
  campaign: 'GET /affiliate/campaigns/:campaignId/revisions/:revision',
  catalog: 'GET /affiliate/projects/:projectId/catalog?projectVersion=:version',
});
async function loadRuntime() {
  try {
    const modules = await Promise.all([
      import('../../dist/modules/affiliate/domain/affiliate-contracts.js'),
      import('../../dist/modules/affiliate/domain/affiliate-catalog.js'),
      import('../../dist/modules/project/domain/project-contracts.js'),
      import('../../dist/modules/affiliate/infrastructure/qualification-image.reader.js'),
    ]);
    return Object.assign({}, ...modules);
  } catch {
    throw Error('FIRST_COMMERCIAL_PRODUCT_BUILD_REQUIRED');
  }
}

// Composition of the existing contracts and read-only image inspector, not a
// second catalog or registration service. No DB, HTTP client or .env loader.
export async function inspectFirstCommercialProduct(candidate, runtime) {
  const report = {
    schemaVersion: 'first-commercial-product-dry-run/1.0.0',
    mode: 'DRY_RUN',
    technicalStatus: 'BLOCKED',
    realProductStatus: 'MISSING',
    realProductAuthorized: false,
    registrationAuthorized: false,
    databaseChanged: false,
    externalCalls: 0,
    publicationAuthorized: false,
    identity: null,
    documentary: {
      product: 'MISSING',
      brand: 'MISSING',
      attributes: 'MISSING',
      imageRights: 'MISSING',
      affiliateLink: 'MISSING',
      affiliateAssociation: 'NOT_VERIFIED',
      externalRights: 'NOT_VERIFIED',
      projectPersistence: 'NOT_VERIFIED',
      humanDecision: 'NOT_PROVIDED',
    },
    physicalImage: { status: 'PENDING', reason: 'LOCAL_IMAGE_REQUIRED' },
    currentCommercialData: {
      price: 'UNKNOWN',
      stock: 'UNKNOWN',
      commission: 'UNKNOWN',
    },
    technicalBlockers: [],
    operationalBlockers: [
      'REAL_PRODUCT_AUTHORIZATION_REQUIRED',
      'PROJECT_PERSISTENCE_UNVERIFIED',
      'EXTERNAL_MEDIA_RIGHTS_VERIFICATION_REQUIRED',
      'AFFILIATE_ASSOCIATION_UNVERIFIED',
      'CURRENT_SHOPEE_DATA_UNVERIFIED',
      'BLOCKED_COST_UNCONFIRMED',
    ],
    requiredFields: [...requiredFields],
    endpoints: { ...endpoints },
    firstBlocker: null,
    nextHumanAction:
      'Fornecer candidate.json real explícito, snapshot do projeto e documentação de produto, afiliação e direitos; disponibilizar o PNG autorizado no armazenamento local por hash.',
  };
  const finish = () => {
    report.technicalBlockers = [...new Set(report.technicalBlockers)];
    report.firstBlocker =
      report.technicalBlockers[0] ?? report.operationalBlockers[0];
    return report;
  };
  if (candidate === undefined) {
    report.technicalBlockers.push('OPERATOR_PROVIDED_INPUT_REQUIRED');
    return finish();
  }
  if (
    !candidate ||
    typeof candidate !== 'object' ||
    Array.isArray(candidate) ||
    Object.keys(candidate).length !== 4 ||
    ['dataOrigin', 'project', 'product', 'campaign'].some(
      (k) => !Object.hasOwn(candidate, k),
    ) ||
    !['OPERATOR_PROVIDED', 'FICTITIOUS_TEST_ONLY'].includes(
      candidate.dataOrigin,
    )
  ) {
    report.technicalBlockers.push('CANDIDATE_ENVELOPE_INVALID');
    return finish();
  }
  const input = structuredClone(candidate),
    api = runtime ?? (await loadRuntime());
  report.realProductStatus =
    input.dataOrigin === 'FICTITIOUS_TEST_ONLY'
      ? 'FICTITIOUS_TEST_ONLY'
      : 'OPERATOR_PROVIDED_UNVERIFIED';
  let product, campaign, project;
  try {
    product = api.validateAffiliateProduct(input.product);
  } catch {
    report.technicalBlockers.push('PRODUCT_CONTRACT_INVALID');
  }
  try {
    campaign = api.validateAffiliateCampaign(input.campaign);
  } catch {
    report.technicalBlockers.push('CAMPAIGN_CONTRACT_INVALID');
  }
  try {
    project = api.validateProjectSnapshot(input.project);
  } catch {
    report.technicalBlockers.push('PROJECT_CONTRACT_INVALID');
  }
  if (report.technicalBlockers.length) return finish();
  report.identity = {
    productId: product.productId,
    productRevision: product.revision,
    productHash: api.affiliateHash(product),
    campaignId: campaign.campaignId,
    campaignRevision: campaign.revision,
    campaignHash: api.affiliateHash(campaign),
    projectId: project.project.id,
    projectVersion: project.project.version,
    projectHash: api.affiliateHash(project),
    imageHash: product.localImage?.contentHash ?? null,
    candidateHash: api.affiliateHash(input),
  };
  report.documentary.product = 'DOCUMENTED_NOT_EXTERNALLY_VERIFIED';
  report.documentary.brand =
    product.schemaVersion === 'affiliate-product/2.0.0'
      ? product.brand.status === 'KNOWN'
        ? 'DOCUMENTED_NOT_EXTERNALLY_VERIFIED'
        : product.brand.status
      : 'LEGACY_DECLARATION_UNVERIFIED';
  report.documentary.attributes = product.attributes.length
    ? 'DOCUMENTED_NOT_EXTERNALLY_VERIFIED'
    : 'MISSING';
  if (!product.attributes.length)
    report.technicalBlockers.push('PRODUCT_CHARACTERISTICS_REQUIRED');
  if (campaign.projectId !== project.project.id)
    report.technicalBlockers.push('PROJECT_SCOPE_MISMATCH');
  const eligibility = api.evaluateCatalogCandidate({ product, campaign });
  report.technicalBlockers.push(...eligibility.technicalBlockers);
  report.documentary.imageRights = eligibility.reusableMediaRights
    ? 'DOCUMENTED_NOT_EXTERNALLY_VERIFIED'
    : 'MISSING_OR_INSUFFICIENT';
  report.documentary.affiliateLink = eligibility.affiliateLinkPresent
    ? 'URL_PRESENT_ASSOCIATION_UNVERIFIED'
    : 'MISSING';
  report.physicalImage = await api.inspectQualificationImage(
    product.localImage,
  );
  if (report.physicalImage.status !== 'VERIFIED')
    report.technicalBlockers.push(report.physicalImage.reason);
  if (!report.technicalBlockers.length) {
    report.technicalStatus = 'TECHNICAL_ONBOARDING_PASS';
    report.nextHumanAction =
      'Conferir projeto/revisões persistidos, documentação externa de produto/direitos e associação afiliada; obter decisão humana antes de qualquer cadastro real. Os endpoints manuais existentes são suficientes; este comando não os executa.';
  }
  return finish();
}

export async function runFirstCommercialProduct(args, runtime) {
  const options = new Map();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!['--dry-run', '--input', '--output'].includes(key) || options.has(key))
      throw Error('FIRST_COMMERCIAL_PRODUCT_ARGUMENTS_INVALID');
    if (key === '--dry-run') {
      options.set(key, true);
      continue;
    }
    const value = args[++i];
    if (!value || value.startsWith('--') || !isAbsolute(value))
      throw Error('FIRST_COMMERCIAL_PRODUCT_ARGUMENTS_INVALID');
    options.set(key, value);
  }
  if (!options.has('--dry-run'))
    throw Error('FIRST_COMMERCIAL_PRODUCT_ARGUMENTS_INVALID');
  let candidate;
  if (options.has('--input')) {
    let file;
    try {
      file = await open(options.get('--input'), 'r');
      const info = await file.stat();
      if (!info.isFile() || info.size < 1 || info.size > 1048576) throw Error();
      const buffer = Buffer.alloc(1048577);
      let total = 0;
      while (total < buffer.length) {
        const { bytesRead } = await file.read(
          buffer,
          total,
          buffer.length - total,
          total,
        );
        if (!bytesRead) break;
        total += bytesRead;
      }
      if (total > 1048576) throw Error();
      candidate = JSON.parse(buffer.subarray(0, total).toString('utf8'));
    } catch {
      throw Error('FIRST_COMMERCIAL_PRODUCT_INPUT_INVALID');
    } finally {
      await file?.close();
    }
  }
  const report = await inspectFirstCommercialProduct(candidate, runtime);
  if (options.has('--output')) {
    try {
      await writeFile(
        options.get('--output'),
        JSON.stringify(report, null, 2) + '\n',
        { flag: 'wx', mode: 0o600 },
      );
    } catch {
      throw Error('FIRST_COMMERCIAL_PRODUCT_OUTPUT_UNAVAILABLE');
    }
  }
  return report;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const report = await runFirstCommercialProduct(process.argv.slice(2));
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.exitCode =
      report.technicalStatus === 'TECHNICAL_ONBOARDING_PASS' ? 0 : 2;
  } catch (error) {
    const code =
      error instanceof Error &&
      /^FIRST_COMMERCIAL_PRODUCT_[A-Z_]+$/.test(error.message)
        ? error.message
        : 'FIRST_COMMERCIAL_PRODUCT_INSPECTION_FAILED';
    process.stderr.write(code + '\n');
    process.exitCode = 1;
  }
}
