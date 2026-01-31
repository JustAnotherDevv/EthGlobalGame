import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

interface MainMenuProps {
  onStart: () => void
}

export function MainMenu({ onStart }: MainMenuProps) {
  return (
    <div className="flex items-center justify-center w-full h-full bg-slate-900 overflow-hidden">
      <Card className="w-[400px] shadow-2xl">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-bold">3D Controller Game</CardTitle>
          <CardDescription>Experience a smooth 3D world with physics</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="space-y-2">
            <h3 className="font-semibold text-sm">Controls:</h3>
            <ul className="text-sm text-muted-foreground list-disc list-inside">
              <li>WASD to move</li>
              <li>Space to jump</li>
              <li>Click to look around</li>
            </ul>
          </div>
          <Button size="lg" className="w-full mt-4" onClick={onStart}>
            Play Now
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
