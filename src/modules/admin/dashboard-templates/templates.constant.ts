import { SectionType } from "./dto/create-templates.dto";

export const DEFAULT_FIXED_SECTIONS = [
  {
    order: 100,
    type: SectionType.PRIORITY_REPAIR_PLANNING,
    label: 'Priority Repair Planning',
    isDynamic: false,
    config: {},
    style: {},
  },
  {
    order: 101,
    type: SectionType.DOCUMENTS,
    label: 'Documents',
    isDynamic: false,
    config: {},
    style: {},
  },
  {
    order: 102,
    type: SectionType.ADDITIONAL_INFORMATION,
    label: 'Additional Information',
    isDynamic: false,
    config: {},
    style: {},
  },
] as const;

export const FIXED_SECTION_TYPES = new Set<SectionType>([
  SectionType.PRIORITY_REPAIR_PLANNING,
  SectionType.DOCUMENTS,
  SectionType.ADDITIONAL_INFORMATION,
]);