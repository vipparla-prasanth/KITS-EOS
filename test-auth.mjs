const SUPABASE_URL = 'https://ueufoizvtrfwmmikvrpp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVldWZvaXp2dHJmd21taWt2cnBwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3MTg3MTcsImV4cCI6MjEwMzI5NDcxN30.LlwnuU2g8crUdYqFX9zAHO-sPsyayoef0nkauZY_Lc8';

async function testSignup() {
  const email = 'test_student_' + Date.now() + '@example.com';
  console.log("Signing up test user:", email);
  
  const response = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email,
      password: 'SecurePassword123!'
    })
  });
  
  const data = await response.json();
  if (!response.ok) {
    console.error("Signup failed:", data);
    process.exit(1);
  }
  
  console.log("Signup success! Auth User ID:", data.user.id);
}

testSignup();
