import { Module } from '@nestjs/common';
import { BootstrapModule } from './bootstrap/bootstrap.module.js';
import { HealthController } from './health.controller.js';
import { ProductsModule } from './features/products/products.module.js';
import { UsersModule } from './features/users/users.module.js';
import { CartModule } from './features/cart/cart.module.js';
import { WishlistModule } from './features/wishlist/wishlist.module.js';

@Module({
  imports: [BootstrapModule, UsersModule, ProductsModule, CartModule, WishlistModule],
  controllers: [HealthController],
})
export class AppModule {}
