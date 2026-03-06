import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    const secret = process.env.JWT_SECRET || 'your-super-secret-jwt-key';
    console.log('🔑 JwtStrategy initialized with secret:', secret.substring(0, 10) + '...');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: any) {
    console.log('✅ JWT Validate SUCCESS - Payload:', payload);
    return { id: payload.sub, email: payload.email, orgId: payload.orgId };
  }
}
