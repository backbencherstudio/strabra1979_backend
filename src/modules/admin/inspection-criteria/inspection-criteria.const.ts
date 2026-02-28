export const INSPECTION_CRITERIA = {
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

      // Scored categories shown in the checklist — must sum to 100 pts
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

      // Media fields that can be attached to an inspection with photos/videos/docs
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
    };