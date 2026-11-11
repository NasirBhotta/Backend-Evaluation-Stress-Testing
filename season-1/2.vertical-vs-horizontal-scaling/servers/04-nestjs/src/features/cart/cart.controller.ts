import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import mongoose from 'mongoose';
import { CartItem } from './cart.model.js';
import * as validate from './cart.validation.js';
import { httpError } from '../../shared/error.js';
import { parseLimit, buildCursorFilter, buildNextCursor } from '../../shared/pagination.js';
import { AuthGuard } from '../../shared/auth.js';

@Controller('cart')
@UseGuards(AuthGuard)
export class CartController {
  @Get()
  async list(@Req() req: FastifyRequest, @Query() query: Record<string, unknown>) {
    const limit = parseLimit(query.limit);
    const filter = buildCursorFilter(query.cursor);
    const userId = req.user!.id;

    const items = await CartItem.find({ ...filter, userId }).sort({ _id: 1 }).limit(limit).populate('productId').lean();

    const totalAgg = await CartItem.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId) } },
      {
        $lookup: {
          from: 'products',
          localField: 'productId',
          foreignField: '_id',
          as: 'product',
        },
      },
      { $unwind: '$product' },
      {
        $group: {
          _id: null,
          total: { $sum: { $multiply: ['$product.price', '$qty'] } },
        },
      },
    ]);
    const total = totalAgg[0]?.total ?? 0;
    return { items, nextCursor: buildNextCursor(items, limit), total };
  }

  @Get(':id')
  async getById(@Req() req: FastifyRequest, @Param('id') id: string) {
    const item = await CartItem.findOne({ _id: id, userId: req.user!.id }).populate('productId').lean();
    if (!item) throw httpError(404, 'Cart item not found');
    return item;
  }

  @Post()
  async add(
    @Req() req: FastifyRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const payload = validate.validateAdd(body);
    const userId = req.user!.id;
    const wasExisting = await CartItem.exists({ userId, productId: payload.productId });
    const item = await CartItem.findOneAndUpdate(
      { userId, productId: payload.productId },
      { $inc: { qty: payload.qty } },
      { upsert: true, new: true },
    );
    reply.code(wasExisting ? 200 : 201);
    return item;
  }

  @Put(':id')
  async update(@Req() req: FastifyRequest, @Param('id') id: string, @Body() body: unknown) {
    const patch = validate.validateUpdate(body);
    const item = await CartItem.findOneAndUpdate({ _id: id, userId: req.user!.id }, patch, {
      new: true,
      runValidators: true,
    });
    if (!item) throw httpError(404, 'Cart item not found');
    return item;
  }

  @Patch(':id/quantity')
  async adjustQuantity(@Req() req: FastifyRequest, @Param('id') id: string, @Body() body: unknown) {
    const delta = validate.validateQuantityDelta(body);
    const userId = req.user!.id;

    if (delta > 0) {
      const item = await CartItem.findOneAndUpdate({ _id: id, userId }, { $inc: { qty: delta } }, { new: true });
      if (!item) throw httpError(404, 'Cart item not found');
      return item;
    }

    const decremented = await CartItem.findOneAndUpdate(
      { _id: id, userId, qty: { $gt: -delta } },
      { $inc: { qty: delta } },
      { new: true },
    );
    if (decremented) return decremented;

    const deleted = await CartItem.findOneAndDelete({ _id: id, userId });
    if (!deleted) throw httpError(404, 'Cart item not found');
    return { deleted };
  }

  @Delete(':id')
  async remove(@Req() req: FastifyRequest, @Param('id') id: string) {
    const item = await CartItem.findOneAndDelete({ _id: id, userId: req.user!.id });
    if (!item) throw httpError(404, 'Cart item not found');
    return { deleted: item };
  }
}
