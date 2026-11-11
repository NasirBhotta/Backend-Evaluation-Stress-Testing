import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { WishlistItem } from './wishlist.model.js';
import * as validate from './wishlist.validation.js';
import { httpError } from '../../shared/error.js';
import { parseLimit, buildCursorFilter, buildNextCursor } from '../../shared/pagination.js';
import { AuthGuard } from '../../shared/auth.js';

@Controller('wishlist')
@UseGuards(AuthGuard)
export class WishlistController {
  @Get()
  async list(@Req() req: FastifyRequest, @Query() query: Record<string, unknown>) {
    const limit = parseLimit(query.limit);
    const filter = buildCursorFilter(query.cursor);
    const items = await WishlistItem.find({ ...filter, userId: req.user!.id })
      .sort({ _id: 1 })
      .limit(limit)
      .populate('productId')
      .lean();
    return { items, nextCursor: buildNextCursor(items, limit) };
  }

  @Get(':id')
  async getById(@Req() req: FastifyRequest, @Param('id') id: string) {
    const item = await WishlistItem.findOne({ _id: id, userId: req.user!.id }).populate('productId').lean();
    if (!item) throw httpError(404, 'Wishlist item not found');
    return item;
  }

  @Post()
  @HttpCode(201)
  async add(@Req() req: FastifyRequest, @Body() body: unknown) {
    const payload = validate.validateAdd(body);
    try {
      return await WishlistItem.create({ ...payload, userId: req.user!.id });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw httpError(409, 'Product already in wishlist');
      throw err;
    }
  }

  @Delete(':id')
  async remove(@Req() req: FastifyRequest, @Param('id') id: string) {
    const item = await WishlistItem.findOneAndDelete({ _id: id, userId: req.user!.id });
    if (!item) throw httpError(404, 'Wishlist item not found');
    return { deleted: item };
  }
}
