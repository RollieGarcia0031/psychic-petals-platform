"use client";

import { useState } from "react";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Leaf, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

export default function AuthPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleAuth = async (isLogin: boolean, e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
      router.push("/");
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("An error occurred");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50/50 p-4">
      <div className="flex flex-col items-center mb-8">
        <div className="bg-primary/10 p-3 rounded-full mb-4 ring-1 ring-primary/20">
          <Leaf className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Psychic Petals</h1>
        <p className="text-sm text-gray-500 mt-1">Read Stories Written from Terminal</p>
      </div>

      <div className="w-full max-w-md">
        <Tabs defaultValue="login" className="w-full">
          <TabsList className="flex w-full mb-6 p-1 bg-white border shadow-sm">
            <TabsTrigger value="login" className="rounded-md data-[state=active]:bg-primary/10 data-[state=active]:text-primary">Login</TabsTrigger>
            <TabsTrigger value="signup" className="rounded-md data-[state=active]:bg-primary/10 data-[state=active]:text-primary">Sign up</TabsTrigger>
          </TabsList>
          
          <TabsContent value="login">
            <Card className="border-0 shadow-lg ring-1 ring-black/5 bg-white">
              <CardHeader className="pb-4">
                <CardTitle className="text-xl">Welcome back</CardTitle>
                <CardDescription>
                  Enter your email to sign in to your account.
                </CardDescription>
              </CardHeader>
              <form onSubmit={(e) => handleAuth(true, e)}>
                <CardContent className="space-y-4 mb-6">
                  {error && <div className="text-sm text-red-500 bg-red-50 p-3 rounded-md">{error}</div>}
                  <div className="space-y-2">
                    <Label htmlFor="login-email">Email</Label>
                    <Input 
                      id="login-email" 
                      type="email" 
                      placeholder="user@example.com" 
                      required 
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={loading}
                      className="bg-gray-50/50"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="login-password">Password</Label>
                      <a href="#" className="text-xs text-primary hover:underline">Forgot password?</a>
                    </div>
                    <Input 
                      id="login-password" 
                      type="password" 
                      required 
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={loading}
                      className="bg-gray-50/50"
                    />
                  </div>
                </CardContent>
                <CardFooter>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    Sign in
                  </Button>
                </CardFooter>
              </form>
            </Card>
          </TabsContent>

          <TabsContent value="signup">
            <Card className="border-0 shadow-lg ring-1 ring-black/5 bg-white">
              <CardHeader className="pb-4">
                <CardTitle className="text-xl">Create an account</CardTitle>
                <CardDescription>
                  Enter your email below to create your account.
                </CardDescription>
              </CardHeader>
              <form onSubmit={(e) => handleAuth(false, e)}>
                <CardContent className="space-y-4 mb-6">
                  {error && <div className="text-sm text-red-500 bg-red-50 p-3 rounded-md">{error}</div>}
                  <div className="space-y-2">
                    <Label htmlFor="signup-email">Email</Label>
                    <Input 
                      id="signup-email" 
                      type="email" 
                      placeholder="user@example.com" 
                      required 
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={loading}
                      className="bg-gray-50/50"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password">Password</Label>
                    <Input 
                      id="signup-password" 
                      type="password" 
                      required 
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={loading}
                      className="bg-gray-50/50"
                    />
                  </div>
                </CardContent>
                <CardFooter>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    Create account
                  </Button>
                </CardFooter>
              </form>
            </Card>
          </TabsContent>
        </Tabs>
        
        <p className="text-center text-xs text-gray-500 mt-8">
          By clicking continue, you agree to our <a href="#" className="underline hover:text-gray-800">Terms of Service</a> and <a href="#" className="underline hover:text-gray-800">Privacy Policy</a>.
        </p>
      </div>
    </div>
  );
}
