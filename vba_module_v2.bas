' ============================================================
' vba_module_v2.bas — RKVV JEKA Trainingsplanner v2 VBA-koppeling
' ============================================================
' Importeer dit bestand in Excel via:
'   Alt+F11 → Bestand → Bestand importeren → selecteer dit bestand
'
' Of kopieer de code handmatig in een module.
'
' Versie 2: Geen FORMULIER-blad, geen handmatige invoer per team.
' Het rooster wordt volledig automatisch gegenereerd op basis van
' de categorie-regels in het LOGICA-blad.
'
' CONFIGURATIE: Pas PYTHON_PATH aan voor jouw machine indien nodig.
' ============================================================

Option Explicit

' --- Configuratie ---
Const PYTHON_PATH    As String  = "python3"
Const SCRIPT_PATH    As String  = "planner_v2.py"
Const WACHT_SECONDEN As Integer = 10  ' vergroot bij grote datasets


' ============================================================
' Macro 1: GenereerRooster
' Gekoppeld aan de "Genereer Rooster"-knop op het ROOSTER-blad.
' Roept planner_v2.py aan via Shell() en herlaadt het ROOSTER-blad.
' ============================================================
Sub GenereerRooster()
    Dim wb_pad   As String
    Dim commando As String
    Dim antwoord As Integer

    antwoord = MsgBox("Wil je het rooster nu (opnieuw) genereren? " & Chr(13) & _
                      "Het huidige rooster wordt overschreven.", _
                      vbYesNo + vbQuestion, "JEKA Planner v2")
    If antwoord = vbNo Then Exit Sub

    ' Sla het werkboek op zodat Python de meest recente data leest
    ThisWorkbook.Save

    wb_pad = ThisWorkbook.FullName

    Dim script_pad As String
    script_pad = ThisWorkbook.Path & "/" & SCRIPT_PATH

    commando = PYTHON_PATH & " """ & script_pad & """ --file """ & wb_pad & """"

    Shell commando, vbHide

    Dim start_tijd As Double
    start_tijd = Timer
    Do While Timer < start_tijd + WACHT_SECONDEN
        DoEvents
    Loop

    ThisWorkbook.Sheets("ROOSTER").Calculate
    Application.ScreenUpdating = True

    MsgBox "Rooster gegenereerd! Controleer het ROOSTER-blad.", _
           vbInformation, "JEKA Planner v2"

End Sub


' ============================================================
' Macro 2: GenereerRoosterLeeg
' Roept planner_v2.py aan met DATA_LEEG als input en ROOSTER_LEEG als output.
' ============================================================
Sub GenereerRoosterLeeg()
    Dim wb_pad   As String
    Dim commando As String
    Dim antwoord As Integer

    antwoord = MsgBox("Wil je ROOSTER_LEEG genereren op basis van DATA_LEEG? " & Chr(13) & _
                      "Het huidige ROOSTER_LEEG wordt overschreven.", _
                      vbYesNo + vbQuestion, "JEKA Planner v2")
    If antwoord = vbNo Then Exit Sub

    ThisWorkbook.Save

    wb_pad = ThisWorkbook.FullName

    Dim script_pad As String
    script_pad = ThisWorkbook.Path & "/" & SCRIPT_PATH

    commando = PYTHON_PATH & " """ & script_pad & """ --file """ & wb_pad & _
               """ --data-sheet ""DATA_LEEG"" --rooster-sheet ""ROOSTER_LEEG"""

    Shell commando, vbHide

    Dim start_tijd As Double
    start_tijd = Timer
    Do While Timer < start_tijd + WACHT_SECONDEN
        DoEvents
    Loop

    ThisWorkbook.Sheets("ROOSTER_LEEG").Calculate
    Application.ScreenUpdating = True

    MsgBox "Rooster gegenereerd! Controleer het ROOSTER_LEEG-blad.", _
           vbInformation, "JEKA Planner v2"

End Sub


' ============================================================
' Helper: NavigeerNaarROOSTER
' ============================================================
Sub NavigeerNaarROOSTER()
    ThisWorkbook.Sheets("ROOSTER").Activate
    ThisWorkbook.Sheets("ROOSTER").Range("A1").Select
End Sub


' ============================================================
' Helper: MaakKnoppen
' Eenmalig uitvoeren na het importeren van dit VBA-bestand.
' Maakt een "Genereer"-knop aan op het ROOSTER_LEEG-blad.
' ============================================================
Sub MaakKnoppen()
    Dim ws  As Worksheet
    Dim shp As Shape
    Dim btn As Shape

    Set ws = ThisWorkbook.Sheets("ROOSTER_LEEG")

    For Each shp In ws.Shapes
        If shp.Name = "KnopGenereerLeeg" Then shp.Delete
    Next shp

    Set btn = ws.Shapes.AddShape(msoShapeRoundedRectangle, 10, 10, 280, 32)
    btn.Name     = "KnopGenereerLeeg"
    btn.OnAction = "GenereerRoosterLeeg"

    With btn.Fill
        .ForeColor.RGB = RGB(46, 117, 182)
        .Visible       = msoTrue
    End With
    With btn.Line
        .Visible = msoFalse
    End With
    With btn.TextFrame
        .Characters.Text = Chr(9654) & " Genereer Rooster (DATA_LEEG) — v2"
        With .Characters.Font
            .Color = RGB(255, 255, 255)
            .Bold  = True
            .Size  = 10
        End With
        .HorizontalAlignment = xlHAlignCenter
        .VerticalAlignment   = xlVAlignCenter
    End With

    MsgBox "Knop aangemaakt op ROOSTER_LEEG-blad.", vbInformation, "JEKA Planner v2"
End Sub
