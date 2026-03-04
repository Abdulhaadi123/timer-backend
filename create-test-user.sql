-- Create Test User for Timer Desktop App Login
-- Run this in your PostgreSQL database

-- Step 1: Get organization ID (replace with your actual org ID if needed)
-- SELECT id, name FROM organizations LIMIT 1;

-- Step 2: Create user (update organization_id with actual ID from step 1)
DO $$
DECLARE
    v_org_id UUID;
    v_user_id UUID := gen_random_uuid();
BEGIN
    -- Get first organization
    SELECT id INTO v_org_id FROM organizations LIMIT 1;
    
    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'No organization found. Please create an organization first.';
    END IF;

    -- Create user
    INSERT INTO users (
        id, 
        email, 
        password_hash, 
        full_name, 
        is_active, 
        email_verified, 
        org_id,
        created_at,
        updated_at
    ) VALUES (
        v_user_id,
        'test@example.com',
        '$2b$10$rZ5qH8qH8qH8qH8qH8qH8.O8qH8qH8qH8qH8qH8qH8qH8qH8qH8qH', -- password: password123
        'Test User',
        true,
        true,
        v_org_id,
        NOW(),
        NOW()
    )
    ON CONFLICT (email) DO NOTHING;

    -- Create user role
    INSERT INTO user_organization_roles (
        user_id,
        organization_id,
        role,
        created_at,
        updated_at
    ) VALUES (
        v_user_id,
        v_org_id,
        'EMPLOYEE',
        NOW(),
        NOW()
    )
    ON CONFLICT (user_id, organization_id) DO NOTHING;

    -- Create tracker profile
    INSERT INTO tracker_profiles (
        user_id,
        screenshot_enabled,
        created_at,
        updated_at
    ) VALUES (
        v_user_id,
        true,
        NOW(),
        NOW()
    )
    ON CONFLICT (user_id) DO NOTHING;

    RAISE NOTICE 'User created successfully!';
    RAISE NOTICE 'Email: test@example.com';
    RAISE NOTICE 'Password: password123';
END $$;
