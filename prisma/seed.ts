import * as bcrypt from 'bcrypt';
import { PrismaClient, UserStatus } from './generated/client';
import { Role } from '../src/common/guard/role/role.enum';
import appConfig from '../src/config/app.config';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = appConfig().database.url;

const adapter = new PrismaPg({
  connectionString,
});

const prisma = new PrismaClient({
  adapter,
});

// ─────────────────────────────────────────────────────────────────────────────
// SEED DATA
// ─────────────────────────────────────────────────────────────────────────────

const INSPECTION_CRITERIA_SEED = {
  name: 'Standard Roof Inspection Criteria',
  description:
    'Default criteria for commercial and residential roof inspections. ' +
    'Covers surface condition, seams, drainage, penetrations, repairs, and age.',
  isActive: true,

  // Input fields shown at the top of the inspection form
  headerFields: [
    {
      key: 'inspectionTitle',
      label: 'Inspection Title',
      type: 'text',
      required: true,
    },
    {
      key: 'propertyType',
      label: 'Property Type',
      type: 'dropdown',
      options: ['Commercial', 'Residential', 'Industrial', 'Mixed Use'],
      required: false,
    },
    {
      key: 'roofSystemType',
      label: 'Roof System Type',
      type: 'dropdown',
      options: [
        'TPO',
        'Metal',
        'Shingle',
        'EPDM',
        'Modified Bitumen',
        'Built-Up',
      ],
      required: false,
    },
    {
      key: 'drainageType',
      label: 'Drainage Type',
      type: 'dropdown',
      options: ['Internal', 'External', 'Scupper', 'Gutters'],
      required: false,
    },
    {
      key: 'inspectorName',
      label: 'Inspector Name',
      type: 'text',
      required: true,
    },
    {
      key: 'inspectionDate',
      label: 'Inspection Date',
      type: 'date',
      required: true,
    },
  ],

  // Scored categories shown in the checklist — must sum to 100 pts
  scoringCategories: [
    {
      key: 'surfaceCondition',
      label: 'Surface Condition',
      maxPoints: 25,
      description:
        'Evaluate blistering, cracking, granule loss, and membrane integrity.',
    },
    {
      key: 'seamsFlashings',
      label: 'Seams & Flashings',
      maxPoints: 20,
      description:
        'Inspect all seams, base flashings, counter flashings, and edge metal.',
    },
    {
      key: 'drainagePonding',
      label: 'Drainage & Ponding',
      maxPoints: 15,
      description:
        'Check for proper slope, ponding water, clogged drains, and scuppers.',
    },
    {
      key: 'penetrations',
      label: 'Penetrations & Accessories',
      maxPoints: 10,
      description:
        'Inspect HVAC curbs, pipe boots, skylights, vents, and all roof penetrations.',
    },
    {
      key: 'repairsHistory',
      label: 'Repairs & Patch History',
      maxPoints: 10,
      description:
        'Assess quality and extent of prior repairs, patches, and maintenance.',
    },
    {
      key: 'ageExpectedLife',
      label: 'Age vs. Expected Life',
      maxPoints: 10,
      description: 'Compare roof age against manufacturer expected lifespan.',
    },
    {
      key: 'structuralSafety',
      label: 'Structural Safety',
      maxPoints: 10,
      description:
        'Evaluate deck integrity, sagging, and any structural concerns.',
    },
  ],
};

const DASHBOARD_TEMPLATE_SEED = {
  name: 'Standard Property Dashboard',

  // Layout sections rendered on the PropertyDashboard detail page
  // Each section type maps to a React/frontend component
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
        embedType: 'url', // renders aerialMapUrl from Inspection as an iframe/image
        placeholder: 'No aerial map available for this inspection.',
      },
    },
    {
      order: 5,
      type: 'tour_3d',
      label: '3D Roof Tour',
      config: {
        embedType: 'iframe', // renders tourUrl from Inspection as an iframe
        placeholder: 'No 3D tour available for this inspection.',
      },
    },
    {
      order: 6,
      type: 'repair_planning',
      label: 'Priority Repair Planning',
      config: {
        priorityLevels: [
          { key: 'urgent', label: 'Urgent', color: '#EF4444' },
          { key: 'recommended', label: 'Recommended', color: '#F59E0B' },
          { key: 'maintenance', label: 'Maintenance', color: '#3B82F6' },
          {
            key: 'replacement_planning',
            label: 'Replacement Planning',
            color: '#8B5CF6',
          },
        ],
      },
    },
    {
      order: 7,
      type: 'roof_health_rating',
      label: 'Roof Health Rating',
      config: {
        // Renders the per-category scoring sliders from InspectionCriteria
        showNotes: true,
        showMaxPoints: true,
      },
    },
    {
      order: 8,
      type: 'additional_info',
      label: 'Additional Information',
      config: {
        fields: ['nteValue', 'additionalComments'],
        nteLabel: 'NTE (Not to Exceed)',
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
        allowInBrowserView: true, // PDF viewer in modal, no download required
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
        headerFields: INSPECTION_CRITERIA_SEED.headerFields,
        scoringCategories: INSPECTION_CRITERIA_SEED.scoringCategories,
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
        sections: DASHBOARD_TEMPLATE_SEED.sections,
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
