import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    const secret = 'your-super-secret-jwt-key-change-in-production';
    console.log('🔑 JwtStrategy using HARDCODED secret for testing');
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
