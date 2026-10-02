/**
 * Utility functions for exporting and downloading Complete Digital ID Cards, QR Passes, Receipts, and Certificates.
 * Canonical implementation consolidated into @kits-eos/shared.
 */

export {
  downloadSvgAsPng,
  printDocument,
  downloadIdCardAsHighResImage,
  downloadIdCardAsPdf,
  downloadTeamIdCardAsPdf,
  downloadTeamIdCardAsHighResImage,
  renderTeamIdCardToCanvas,
  renderSoloIdCardToCanvas,
  type IdCardRenderOptions,
  type TeamMemberExportItem,
  type TeamIdCardRenderOptions,
} from '@kits-eos/shared';
