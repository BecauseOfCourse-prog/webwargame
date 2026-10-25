import { Controller, Get, Param, Post, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import type { AssetResponse } from '@webwargame/contracts';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { SessionGuard } from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { AssetsService } from './assets.service.js';

@Controller('admin/assets')
@UseGuards(SessionGuard, RolesGuard)
@RequireRoles('ADMIN')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Post()
  async upload(@Req() request: AuthenticatedRequest): Promise<AssetResponse> {
    return { asset: await this.assets.upload(request) };
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<AssetResponse> {
    return { asset: await this.assets.get(id) };
  }

  @Get(':id/content')
  async content(@Param('id') id: string, @Res({ passthrough: true }) response: ServerResponse): Promise<StreamableFile> {
    const { asset, stream } = await this.assets.content(id);
    const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[asset.mimeType];
    const file = new StreamableFile(stream, {
      type: asset.mimeType, length: asset.byteSize, disposition: `inline; filename="${asset.id}.${extension}"`,
    });
    // Native stream errors must not expose paths through the default logger.
    file.setErrorLogger(() => undefined);
    file.setErrorHandler(() => { response.destroy(); });
    return file;
  }
}
