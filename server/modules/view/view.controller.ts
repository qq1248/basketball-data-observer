import { Controller, Get, Render, Req, Header } from '@nestjs/common';
import type { Request } from 'express';

@Controller()
export class ViewController {

  @Get(['/', '*'])
  @Render('index')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  @Header('Pragma', 'no-cache')
  @Header('Expires', '0')
  async render(@Req() req: Request): Promise<{ __platform__: string }> {
    const platformData = req.__platform_data__ ?? {};
    return {
      __platform__: JSON.stringify(platformData),
    };
  }
}
