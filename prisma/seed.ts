import * as bcrypt from 'bcrypt';
import { PrismaClient, UserStatus } from './generated/client';
import { Role } from '../src/common/guard/role/role.enum';
import appConfig from '../src/config/app.config';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = appConfig().database.url;

const adapter = new PrismaPg({ connectionString });

const prisma = new PrismaClient({ adapter });

// ─────────────────────────────────────────────────────────────────────────────
// SEED DATA
// ─────────────────────────────────────────────────────────────────────────────

export const INSPECTION_CRITERIA_SEED = {
  name: 'Standard Roof Inspection Criteria',
  description:
    'Default criteria for commercial and residential roof inspections. ' +
    'Covers surface condition, seams, drainage, penetrations, repairs, and age.',
  isActive: true,

  // ── headerFields Json ───────────────────────────────────────────────────────
  headerFields: [
    {
      key: 'inspectionTitle',
      label: 'Inspection Title',
      type: 'text',
      placeholder: 'Enter inspection title',
      required: true,
      isSystem: true,
      order: 1,
      options: null,
    },
    {
      key: 'propertyType',
      label: 'Property Type',
      type: 'dropdown',
      placeholder: 'Select property type',
      required: false,
      isSystem: true,
      order: 2,
      options: ['Commercial', 'Residential'],
    },
    {
      key: 'roofSystemType',
      label: 'Roof System Type',
      type: 'dropdown',
      placeholder: 'Select roof system',
      required: false,
      isSystem: true,
      order: 3,
      options: ['TPO', 'Metal', 'Shingle'],
    },
    {
      key: 'drainageType',
      label: 'Drainage Type',
      type: 'dropdown',
      placeholder: 'Select drainage type',
      required: false,
      isSystem: true,
      order: 4,
      options: ['Internal', 'External'],
    },
  ],

  // ── scoringCategories Json — must sum to ≤100 pts ──────────────────────────
  scoringCategories: [
    {
      key: 'surfaceCondition',
      label: 'Surface Condition',
      maxPoints: 25,
      isSystem: true,
      order: 1,
    },
    {
      key: 'seamsFlashings',
      label: 'Seams & Flashings',
      maxPoints: 20,
      isSystem: true,
      order: 2,
    },
    {
      key: 'drainagePonding',
      label: 'Drainage & Ponding',
      maxPoints: 15,
      isSystem: true,
      order: 3,
    },
    {
      key: 'penetrations',
      label: 'Penetrations & Accessories',
      maxPoints: 10,
      isSystem: true,
      order: 4,
    },
    {
      key: 'repairsHistory',
      label: 'Repairs & Patch History',
      maxPoints: 10,
      isSystem: true,
      order: 5,
    },
    {
      key: 'ageExpectedLife',
      label: 'Age vs. Expected Life',
      maxPoints: 10,
      isSystem: true,
      order: 6,
    },
  ],

  // ── mediaFields Json ────────────────────────────────────────────────────────
  mediaFields: [
    {
      key: 'mediaFiles',
      label: 'Media Files',
      placeholder: 'Upload Media file',
      type: 'file',
      isSystem: true,
      order: 1,
      accept: ['image/*', 'video/*'],
    },
    {
      key: 'aerialMap',
      label: 'Aerial Map',
      placeholder: 'Upload your file.',
      type: 'file',
      isSystem: true,
      order: 2,
      accept: ['image/*'],
    },
    {
      key: 'tour3d',
      label: '3D Tours',
      placeholder: 'Paste Source URL / iframe Code',
      type: 'embed',
      isSystem: true,
      order: 3,
      accept: null,
    },
    {
      key: 'documents',
      label: 'Documents',
      placeholder: 'Add Documents',
      type: 'document',
      isSystem: true,
      order: 4,
      accept: null,
    },
  ],

  // ── nteConfig Json ──────────────────────────────────────────────────────────
  // { "label": "NTE (Not-To-Exceed)", "placeholder": "Enter NTE" }
  nteConfig: {
    label: 'NTE (Not-To-Exceed)',
    placeholder: 'Enter NTE',
  },

  // ── additionalNotesConfig Json ──────────────────────────────────────────────
  // { "label": "Additional Notes/Comments", "placeholder": "Type Any Additional Notes/Comments" }
  additionalNotesConfig: {
    label: 'Additional Notes/Comments',
    placeholder: 'Type Any Additional Notes/Comments',
  },

  // ── repairPlanningConfig Json ───────────────────────────────────────────────
  // { "statuses": ["Urgent", "Maintenance", "Replacement Planning"] }
  // Only stores the available status options — actual repair items go in Inspection.repairItems
  repairPlanningConfig: {
    statuses: ['Urgent', 'Maintenance', 'Replacement Planning'],
  },

  // ── healthThresholdConfig Json ──────────────────────────────────────────────
  healthThresholdConfig: {
    good: {
      minScore: 70,
      maxScore: 100,
      remainingLifeMinYears: 5,
      remainingLifeMaxYears: 7,
    },
    fair: {
      minScore: 30,
      maxScore: 69,
      remainingLifeMinYears: 3,
      remainingLifeMaxYears: 5,
    },
    poor: {
      minScore: 0,
      maxScore: 29,
      remainingLifeMinYears: 0,
      remainingLifeMaxYears: 2,
    },
  },
};

export const DASHBOARD_TEMPLATE_SEED = {
  name: 'Standard Property Dashboard',

  sections: [
    {
      order: 1,
      type: 'header_info',
      label: 'Property Info',
      config: {
        fields: [
          'propertyName',
          'address',
          'propertyType',
          'inspectionId',
          'inspectorName',
          'inspectionDate',
          'lastInspectionDate',
        ],
      },
    },
    {
      order: 2,
      type: 'health_snapshot',
      label: 'Roof Health Snapshot',
      config: {
        showOverallScore: true,
        showHealthLabel: true, // "Good" | "Fair" | "Poor"
        showRemainingLife: true, // e.g. "5-7 Years"
        showAverageScore: true,
      },
    },
    {
      order: 3,
      type: 'media_grid',
      label: 'Media Files',
      config: {
        layout: 'grid', // "grid" | "carousel"
        maxVisible: 4,
        allowedTypes: ['PHOTO', 'VIDEO'],
      },
    },
    {
      order: 4,
      type: 'aerial_map',
      label: 'Aerial Map',
      config: {
        embedType: 'url', // renders MediaFile with mediaFieldKey="aerialMap"
        placeholder: 'No aerial map available for this inspection.',
      },
    },
    {
      order: 5,
      type: 'tour_3d',
      label: '3D Roof Tour',
      config: {
        embedType: 'iframe', // renders MediaFile with mediaFieldKey="tour3d"
        placeholder: 'No 3D tour available for this inspection.',
      },
    },
    {
      order: 6,
      type: 'repair_planning',
      label: 'Priority Repair Planning',
      config: {
        // Status options come from criteria.repairPlanningConfig.statuses at runtime
        // Actual items come from Inspection.repairItems
      },
    },
    {
      order: 7,
      type: 'roof_health_rating',
      label: 'Roof Health Rating',
      config: {
        showNotes: true,
        showMaxPoints: true,
      },
    },
    {
      order: 8,
      type: 'additional_info',
      label: 'Additional Information',
      config: {
        // Labels come from criteria.nteConfig and criteria.additionalNotesConfig at runtime
        // Values come from Inspection.nteValue and Inspection.additionalComments
        fields: ['nteValue', 'additionalComments'],
        nteCurrency: 'USD',
      },
    },
    {
      order: 9,
      type: 'documents',
      label: 'Documents',
      config: {
        showUploadDate: true,
        showFileSize: true,
        showVersion: true,
        allowInBrowserView: true,
        pageSize: 5,
      },
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  // ── 1. Seed Users ──────────────────────────────────────────────────────────

  const roles = [
    Role.ADMIN,
    Role.PROPERTY_MANAGER,
    Role.AUTHORIZED_VIEWER,
    Role.OPERATIONAL,
  ];

  const password = await bcrypt.hash('12345678', 10);

  for (const role of roles) {
    const email = `${role.toLowerCase()}@gmail.com`;
    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing) {
      console.log(`✅ ${role} user already exists`);
      continue;
    }

    await prisma.user.create({
      data: {
        email,
        username: role.toLowerCase(),
        password,
        role,
        status: UserStatus.ACTIVE,
        approved_at: new Date(),
        approved_by: 'SYSTEM',
      },
    });

    console.log(`🚀 Created ${role} user → ${email}`);
  }

  // ── 2. Seed Inspection Criteria ────────────────────────────────────────────

  let criteria = await prisma.inspectionCriteria.findFirst({
    where: { name: INSPECTION_CRITERIA_SEED.name },
  });

  if (criteria) {
    console.log('✅ Inspection criteria already exists');
  } else {
    criteria = await prisma.inspectionCriteria.create({
      data: {
        name: INSPECTION_CRITERIA_SEED.name,
        description: INSPECTION_CRITERIA_SEED.description,
        isActive: INSPECTION_CRITERIA_SEED.isActive,
        headerFields: INSPECTION_CRITERIA_SEED.headerFields as any,
        scoringCategories: INSPECTION_CRITERIA_SEED.scoringCategories as any,
        mediaFields: INSPECTION_CRITERIA_SEED.mediaFields as any,
        nteConfig: INSPECTION_CRITERIA_SEED.nteConfig as any,
        additionalNotesConfig:
          INSPECTION_CRITERIA_SEED.additionalNotesConfig as any,
        repairPlanningConfig:
          INSPECTION_CRITERIA_SEED.repairPlanningConfig as any,
        healthThresholdConfig:
          INSPECTION_CRITERIA_SEED.healthThresholdConfig as any,
      },
    });
    console.log(
      `🚀 Created inspection criteria → "${criteria.name}" (${criteria.id})`,
    );
  }

  // ── 3. Seed Dashboard Template ─────────────────────────────────────────────

  const existingTemplate = await prisma.dashboardTemplate.findFirst({
    where: { name: DASHBOARD_TEMPLATE_SEED.name },
  });

  if (existingTemplate) {
    console.log('✅ Dashboard template already exists');
  } else {
    const template = await prisma.dashboardTemplate.create({
      data: {
        name: DASHBOARD_TEMPLATE_SEED.name,
        status: 'ACTIVE',
        criteriaId: criteria.id,
        sections: DASHBOARD_TEMPLATE_SEED.sections as any,
      },
    });
    console.log(
      `🚀 Created dashboard template → "${template.name}" (${template.id})`,
    );
  }

  console.log('\n✨ Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
