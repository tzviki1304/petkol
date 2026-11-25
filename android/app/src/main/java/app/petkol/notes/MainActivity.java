package app.petkol.notes;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PetkolNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
